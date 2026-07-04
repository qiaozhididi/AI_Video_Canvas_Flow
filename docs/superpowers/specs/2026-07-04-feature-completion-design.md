# 功能补全设计：遗留清理 + 技术债 + 功能增强

> 日期: 2026-07-04
> 状态: 待审核

## 概述

基于对项目代码和文档的全面分析，本次迭代聚焦三类问题：
1. **P0 遗留代码清理** — 3个空壳/骨架文件
2. **P1 技术债修复** — 同步I/O、重复代码、占位实现、Token刷新
3. **P1 功能增强** — 处理节点/控制节点标注、模拟状态语义修正

## 变更清单

### 1. 删除后端空壳文件（P0）

| 文件 | 原因 |
|------|------|
| `backend/app/services/project_service.py` | 4个函数全为TODO，CRUD已在projects.py路由直接实现 |
| `backend/app/tasks/ai_tasks.py` | 骨架未调用，AI任务已迁移至render_tasks.py |
| `backend/app/services/workflow_engine.py` | LangGraph骨架未使用，工作流编排在前端workflowExecutor.ts |

**操作**: 直接删除这3个文件，并更新 `backend/app/tasks/__init__.py` 移除 `ai_tasks` 导入。

**检查**: 确认无其他代码import这些模块。

### 2. 后端 auth 添加 refresh token 端点（P1）

**当前问题**: 前端登录后获取 `refresh_token` 但从未使用，access_token 过期后直接跳转登录页。

**后端变更** (`backend/app/api/auth.py`):
- 新增 `POST /auth/refresh` 端点，接受 `refresh_token`，验证后返回新的 `access_token` + `refresh_token`

```python
class RefreshRequest(BaseModel):
    refresh_token: str

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: DBSession):
    """使用 refresh_token 刷新 access_token"""
    try:
        payload = jwt.decode(body.refresh_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="无效的 refresh token")
    except JWTError:
        raise HTTPException(status_code=401, detail="refresh token 已过期")

    # 验证用户存在
    stmt = select(User).where(User.id == uuid.UUID(user_id))
    result = await db.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=401, detail="用户不存在")

    new_access = _create_token(user_id, settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    new_refresh = _create_token(user_id, 60 * 24 * 7)
    return TokenResponse(access_token=new_access, refresh_token=new_refresh)
```

### 3. 前端 Token 自动续期（P1）

**当前问题**: `apiClient.ts` 的 `request()` 函数在 401 时直接清除 token 并跳转登录页。

**前端变更** (`frontend/src/utils/apiClient.ts`):
- 存储 `refresh_token` 到 localStorage
- 401 时先尝试用 `refresh_token` 调 `/auth/refresh`，成功则重试原请求
- 刷新也失败才跳转登录页
- 添加防并发锁，避免多个请求同时刷新

```typescript
let isRefreshing = false;
let pendingRequests: Array<() => void> = [];

async function refreshToken(): Promise<string> {
  if (isRefreshing) {
    return new Promise((resolve) => pendingRequests.push(() => resolve(localStorage.getItem('access_token')!)));
  }
  isRefreshing = true;
  try {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) throw new Error('No refresh token');
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error('Refresh failed');
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    pendingRequests.forEach(cb => cb());
    pendingRequests = [];
    return data.access_token;
  } catch {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHORIZED', '登录已过期');
  } finally {
    isRefreshing = false;
  }
}
```

修改 `request()` 函数：401 时调用 `refreshToken()`，成功后重试原请求。

### 4. MinIO 预签名 URL 真正实现（P1）

**当前问题**: `media_service.py` 使用 `minio` Python SDK 的 `presigned_get_object`，这在**本地部署**下是正确的。经代码审查，当前实现已经是真正的 S3 预签名，API_REFERENCE.md 的描述已过时。

**操作**: 更新 API_REFERENCE.md 的描述（如有），代码无需修改。

### 5. ai_service.py 重复代码消除（P1）

**当前问题**: `call_image_gen` 和 `call_img2img` 有重复的请求/响应处理逻辑。`call_video_gen` 和 `call_audio_gen` 已通过 `_call_ark_async` 统一。

**方案**: 提取 `_call_image_api` 公共函数，`call_image_gen` 和 `call_img2img` 统一调用。

```python
async def _call_image_api(
    db, model_id: str | UUID, prompt: str,
    body_extra: dict | None = None,
    params: dict | None = None,
) -> dict:
    """通用图片 API 调用（文生图/图生图共用）"""
    provider, model = await _get_provider_and_model(db, model_id, expected_type="image_gen")
    url = f"{provider.base_url.rstrip('/')}/images/generations"
    headers = {"Authorization": f"Bearer {provider.api_key}", "Content-Type": "application/json"}
    body: dict = {"model": model.model_id, "prompt": prompt}
    if body_extra:
        body.update(body_extra)
    body.setdefault("n", params.get("n", 1) if params else 1)
    body.setdefault("size", params.get("size", "2k") if params else "2k")

    log_tag = "AI:ImageGen"
    logger.info(f"[{log_tag}] 调用 {provider.name}/{model.display_name}, prompt={prompt[:50]}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            raise RuntimeError(f"图片 API 调用失败: HTTP {response.status_code}: {error_text}")
        data = response.json()

    owner_id = params.get("_owner_id") if params else None
    return await _handle_image_response(db, data, owner_id)

async def call_image_gen(db, model_id, prompt, params=None) -> dict:
    return await _call_image_api(db, model_id, prompt, body_extra=None, params=params)

async def call_img2img(db, model_id, prompt, image_url, params=None) -> dict:
    # 内部 MinIO 路径转 base64 逻辑保留（img2img 特有）
    api_image = await _resolve_image_url(db, image_url)
    return await _call_image_api(db, model_id, prompt, body_extra={"image": api_image}, params=params)
```

提取 `_resolve_image_url()` 函数处理 MinIO 内部路径 → base64 转换逻辑（当前在 `call_img2img` 中内联）。

### 6. 处理节点/控制节点前端标注（P1）

**当前问题**: 4种处理节点(upscale/style_transfer/remove_bg/extend_image)在 EXECUTABLE_SUBTYPES 中，但后端无真实AI API；3种控制节点(if_else/loop/merge)不在 EXECUTABLE_SUBTYPES 中，用户创建后无法执行但无提示。

**前端变更**:

1. 处理节点保留在 EXECUTABLE_SUBTYPES 中（后端有模拟渲染），但在属性面板中显示"演示模式"提示
2. 控制节点添加明确的"不可执行"提示
3. 在 `PropertyPanelWithHistory` 中根据节点 subtype 显示对应提示

### 7. 模拟路径状态语义修正（P1）

**当前问题**: AI任务模拟回退时标记 `status="completed"` + `error_message`，语义矛盾。

**后端变更** (`render_tasks.py`):
- 模拟路径改为 `status="completed"` + `result_url=None` + `error_message="AI 模拟完成(未配置模型): ..."` — 不变，因为：
  - `completed` 表示任务流程走完了（不是 crashed）
  - `error_message` 携带"模拟"信息
  - 前端根据 `result_url is None` 判断无产出

实际上当前实现已合理，只需在**前端**处理 `completed` 但 `result_url` 为空的情况。

**前端变更** (`RenderCenter.tsx`):
- 已完成但无 result_url 的任务，不显示下载按钮，显示"无产出"提示

## 不变更项

| 项目 | 原因 |
|------|------|
| MinIO 预签名 URL | 当前实现已是真正的 S3 预签名，文档描述过时 |
| media.py 同步 I/O | 审查发现已使用 httpx 异步客户端下载（第118行），仅 `from urllib.parse import quote` 用于URL编码，非阻塞 |
| Redis 缓存 | 当前无使用场景，后续迭代 |
| LangGraph 依赖 | 随 workflow_engine.py 一起删除后，检查是否还有其他引用 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 删除空壳文件后有隐式依赖 | 全局搜索 import 语句确认 |
| Token 刷新的竞态条件 | 防并发锁 + pendingRequests 队列 |
| img2img 重构影响现有功能 | 保持相同的外部接口和返回值格式 |
