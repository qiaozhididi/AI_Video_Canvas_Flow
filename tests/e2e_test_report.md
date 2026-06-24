# AI Canvas Flow — 端到端联调测试用例

> 覆盖从登录到协作编辑再到保存的全流程，使用 Shell 脚本 + MCP Chrome DevTools 双轨验证

## 测试环境

| 组件 | 地址 | 说明 |
|------|------|------|
| 前端 Vite Dev Server | `http://localhost:5173` | React 18 + Vite 6 |
| 后端 FastAPI | `http://localhost:8000` | FastAPI + Socket.IO |
| PostgreSQL | `192.168.10.76:5432` | 主数据库 |
| Redis | `192.168.10.76:6379` | 缓存/会话 |
| MinIO | `192.168.10.76:9000` | 对象存储 |
| RabbitMQ | `192.168.10.76:5672` | Celery Broker |

## 测试工具

| 工具 | 用途 | 运行方式 |
|------|------|----------|
| `tests/e2e_test.sh` | Shell 脚本自动化测试 | `bash tests/e2e_test.sh` |
| MCP Chrome DevTools | 浏览器端实时交互验证 | 通过 `evaluate_script` 执行 JS |
| `curl` | HTTP 接口验证 | 命令行 |

---

## 测试用例总览

### T1: 健康检查（2 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 1 | 健康检查状态 | `GET /health` | `{"status":"ok"}` | PASS |
| 2 | 健康检查版本字段 | `GET /health` | 响应包含 `version` | PASS |

### T2: 用户注册（3 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 3 | 注册返回200 | `POST /api/v1/auth/register` | HTTP 200 | PASS |
| 4 | 注册返回用户名 | 同上 | 响应包含 username | PASS |
| 5 | 重复注册返回400 | 重复注册同一用户名 | HTTP 400 | PASS |

### T3: 用户登录（5 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 6 | 登录返回200 | `POST /api/v1/auth/login` | HTTP 200 | PASS |
| 7 | 登录返回 access_token | 同上 | 响应包含 access_token | PASS |
| 8 | 登录返回 refresh_token | 同上 | 响应包含 refresh_token | PASS |
| 9 | 提取 access_token | 解析 JWT | token 非空 | PASS |
| 10 | 错误密码返回401 | 错误密码登录 | HTTP 401 | PASS |

### T4: 项目 CRUD（8 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 11 | 创建项目返回200 | `POST /api/v1/projects/` | HTTP 200 | PASS |
| 12 | 创建项目返回 name | 同上 | 响应包含项目名 | PASS |
| 13 | 提取项目 ID | 解析响应 | ID 非空 | PASS |
| 14 | 项目列表返回200 | `GET /api/v1/projects/` | HTTP 200 | PASS |
| 15 | 项目列表包含测试项目 | 同上 | 包含新建项目 ID | PASS |
| 16 | 项目详情返回200 | `GET /api/v1/projects/{id}` | HTTP 200 | PASS |
| 17 | 删除项目返回204 | `DELETE /api/v1/projects/{id}` | HTTP 204 | PASS |
| 18 | 已删除项目返回404 | 再次获取已删除项目 | HTTP 404 | PASS |

### T5: 媒体资产（5 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 19 | 媒体列表返回200 | `GET /api/v1/media/` | HTTP 200 | PASS |
| 20 | 媒体上传返回成功 | `POST /api/v1/media/upload` | HTTP 200 | PASS |
| 21 | 提取媒体资产 ID | 解析响应 | ID 非空 | PASS |
| 22 | 预签名 URL 返回200 | `GET /api/v1/media/{id}/presign` | HTTP 200 | PASS |
| 23 | 删除媒体返回204 | `DELETE /api/v1/media/{id}` | HTTP 204 | PASS |

### T6: 渲染任务（3 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 24 | 创建渲染任务 | `POST /api/v1/render/` | HTTP 200 | PASS |
| 25 | 查询渲染任务返回200 | `GET /api/v1/render/{id}` | HTTP 200 | PASS |
| 26 | 取消渲染任务 | `POST /api/v1/render/{id}/cancel` | HTTP 200/409 | PASS |

### T7: API 文档（2 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 27 | Swagger 文档可访问 | `GET /docs` | HTTP 200 | PASS |
| 28 | OpenAPI Schema 可访问 | `GET /openapi.json` | HTTP 200 | PASS |

### T8: 协作 WebSocket（8 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 29 | Socket.IO polling 端点可访问 | `GET /socket.io/?EIO=4&transport=polling` | HTTP 200 | PASS |
| 30 | Socket.IO 握手包含 sid | 解析 Engine.IO 响应 | 包含 sid 字段 | PASS |
| 31 | Socket.IO 握手支持 websocket 升级 | 解析 Engine.IO 响应 | upgrades 包含 websocket | PASS |
| 32 | 提取 Socket.IO 会话 SID | 解析 sid | SID 非空 | PASS |
| 33 | Socket.IO POST 连接包 | `POST /socket.io/...&sid=X` body=`40` | HTTP 200 | PASS |
| 34 | Socket.IO 发送 join_project 事件 | `42["join_project",...]` | HTTP 200 | PASS |
| 35 | Socket.IO 发送 ping 事件 | `42["ping",...]` | HTTP 200 | PASS |
| 36 | 协作状态 API 返回200 | `GET /api/v1/collab/status` | HTTP 200 | PASS |

### T9: Vite 代理联调（2 项）

| # | 测试项 | 方法 | 预期结果 | 实际 |
|---|--------|------|----------|------|
| 37 | Vite 代理转发 API 请求 | `GET localhost:5173/api/v1/collab/status` | HTTP 200 | PASS |
| 38 | Vite 代理转发 Socket.IO | `GET localhost:5173/socket.io/?EIO=4&transport=polling` | HTTP 200 | PASS |

---

## MCP 真实场景测试（模拟用户操作）

> 通过 MCP Chrome DevTools 在浏览器中模拟真实用户操作流程，而非仅测试 API 返回值

### 场景1: 注册 → 登录 → 获取用户信息

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 1.1 | 注册新用户 `realuser_xxx` | 200 | 返回 id, username, email |
| 1.2 | 登录 | 200 | access_token + refresh_token 非空 |
| 1.3 | 存储 token 到 localStorage | 成功 | access_token_stored=true |
| 1.4 | 获取当前用户 `/auth/me` | 200 | username 匹配 |
| 1.5 | 错误密码登录 | 401 | 认证拒绝 |

### 场景2: 创建项目 → 进入编辑器 → 添加节点/连线

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 2.1 | 后端创建项目 | 200 | project_id 非空 |
| 2.2 | 获取项目列表 | 200 | count=3 |
| 2.3 | 获取项目详情 | 200 | name/description 匹配 |
| 2.4 | 前端 projectStore 创建本地项目 | 成功 | localStorage 写入 |
| 2.5 | 导航到编辑器 `/editor/{id}` | 成功 | React Flow 画布加载 |
| 2.6 | 点击添加「文本输入」节点 | 成功 | 画布节点+1 |
| 2.7 | 点击添加「图片输入」节点 | 成功 | 画布节点+1 |
| 2.8 | 点击添加「音频输入」节点 | 成功 | 画布节点+1 (共12个) |
| 2.9 | 添加连线(音频输入→文生图) | 成功 | edges+1 |
| 2.10 | 添加连线(图片输入→文生图) | 成功 | edges+1 (共9条) |

**截图**: `tests/screenshots/editor_loaded.png` / `editor_nodes_added.png`

### 场景3: 撤销/重做操作验证

| 步骤 | 操作 | 节点数 | 边数 | 验证点 |
|------|------|--------|------|--------|
| 初始 | - | 12 | 9 | 基准状态 |
| undo×1 | 撤销添加音频输入 | 11 | 9 | canUndo=true, canRedo=true |
| undo×2 | 撤销添加图片输入 | 10 | 9 | 节点减少 |
| redo×1 | 重做添加图片输入 | 11 | 9 | 节点恢复 |
| redo×2 | 重做添加音频输入 | 12 | 9 | 完全恢复原状 |

### 场景4: 自动保存与崩溃恢复

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 7.1 | 查看自动保存状态 | isDirty=false, snapshots=2 | 初始状态 |
| 7.2 | markDirty() | isDirty=true | 脏标记生效 |
| 7.3 | saveNow() | isDirty=false, snapshots=3 | 保存后脏标记重置 |
| 7.4 | localStorage 键检查 | autosave+projects 键存在 | 持久化正常 |
| 7.5 | checkRecovery 方法 | 存在 | 崩溃恢复可用 |
| 7.6 | 最新快照内容 | 12节点/9边 | 数据完整 |
| 7.7 | 再编辑+保存 | snapshots=4, 13节点 | 增量保存正常 |

### 场景5: 媒体上传 → 预签名URL → 删除

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 8.1 | 上传图片 test_screenshot.png | 200, id=77160ad3 | file_type=image/png, size=69 |
| 8.2 | 上传视频 demo_video.mp4 | 200, id=446c91d6 | file_type=video/mp4 |
| 8.3 | 获取媒体列表 | 200, count=2 | 两个资产 |
| 8.4 | 图片预签名URL | 200, url_length=106 | URL 有效 |
| 8.5 | 视频预签名URL | 200, has_url=true | URL 有效 |
| 8.6 | 媒体详情 | 200, file_name 匹配 | 元数据正确 |
| 8.7 | 删除图片 | 204 | 删除成功 |
| 8.8 | 删除后列表 | count=1 | 仅剩视频 |

### 场景6: 渲染任务创建 → 查询 → 取消

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 9.1 | 创建 mp4 渲染任务 | 200, status=pending | 任务创建成功 |
| 9.2 | 查询任务状态 | 200, progress=0 | 状态正确 |
| 9.3 | 轮询（1秒后） | 200, status=pending | 轮询正常 |
| 9.4 | 取消任务 | 200, new_status=cancelled | 取消成功 |
| 9.5 | 取消后确认 | status=cancelled | 状态持久化 |
| 9.6 | 创建 webm 渲染任务 | 200, status=pending | 多格式支持 |

### 场景7: Socket.IO 协作连接 → 事件广播

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 11.1 | WebSocket 连接 | sid=4ZMGhyJq85NBaXNgAAAY | 连接成功 |
| 11.2 | join_project 事件 | 后端日志确认 | 加入项目房间 |
| 11.3 | node_update 事件 | 后端日志: broadcast→project:xxx | 节点更新广播 |
| 11.4 | edge_update 事件 | 后端日志: broadcast→project:xxx | 边更新广播 |
| 11.5 | cursor_move 事件 | 后端日志确认 | 光标移动广播 |
| 11.6 | ping 事件 | 后端日志: latency≈1ms | 延迟检测 |
| 11.7 | pong 收到 | RTT=0ms | 延迟极低 |
| 11.8 | leave_project 事件 | 后端日志确认 | 离开项目 |
| 11.9 | 断开连接 | reason=io client disconnect | 正常断开 |

### 场景8: 清理 → 登出

| 步骤 | 操作 | 结果 | 验证点 |
|------|------|------|--------|
| 12.1 | 获取项目列表 | count=4 | 4个待清理项目 |
| 12.2 | 删除4个项目 | 全部 204 | 删除成功 |
| 12.3 | 确认项目列表为空 | count=0 | 清理完成 |
| 12.4 | 删除1个媒体 | 204 | 媒体清理 |
| 12.5 | 清除 localStorage | 全部清除 | 登出状态 |
| 12.6 | 未认证请求 | 200 | 开发模式无强制认证(预期) |
| 12.7 | 导航回首页 | 成功 | 回到初始状态 |

---

## MCP 浏览器端 E2E 测试

### 测试方式

通过 MCP Chrome DevTools 的 `evaluate_script` 工具，在浏览器中执行 JavaScript 完成全流程测试。

### 浏览器端 API 全流程测试结果

在 `http://localhost:8000/health` 页面执行（同源，无 CORS 限制）：

| 步骤 | API | 状态 | 关键断言 |
|------|-----|------|----------|
| 1. 注册 | `POST /api/v1/auth/register` | 200 | username 正确返回 |
| 2. 登录 | `POST /api/v1/auth/login` | 200 | access_token 非空 |
| 3. 获取当前用户 | `GET /api/v1/auth/me` | 200 | username 匹配 |
| 4. 创建项目 | `POST /api/v1/projects/` | 200 | project_id 非空 |
| 5. 项目列表 | `GET /api/v1/projects/` | 200 | count >= 1 |
| 6. 项目详情 | `GET /api/v1/projects/{id}` | 200 | name 匹配 |
| 7. 上传媒体 | `POST /api/v1/media/upload` | 200 | media_id 非空 |
| 8. 媒体列表 | `GET /api/v1/media/` | 200 | count >= 1 |
| 9. 预签名 URL | `GET /api/v1/media/{id}/presign` | 200 | url 非空 |
| 10. 创建渲染任务 | `POST /api/v1/render/` | 200 | status=pending |
| 11. 查询渲染任务 | `GET /api/v1/render/{id}` | 200 | status=pending |
| 12. 取消渲染任务 | `POST /api/v1/render/{id}/cancel` | 200 | - |
| 13. 协作状态 | `GET /api/v1/collab/status` | 200 | transport=socket.io |
| 14. Socket.IO 握手 | `GET /socket.io/?EIO=4&transport=polling` | 200 | sid 存在 |
| 15. 删除媒体 | `DELETE /api/v1/media/{id}` | 204 | - |
| 16. 删除项目 | `DELETE /api/v1/projects/{id}` | 204 | - |

### Vite 代理联调测试

在 `http://localhost:5173` 页面执行（通过 Vite 代理访问后端）：

| 测试项 | 请求路径 | 状态 |
|--------|----------|------|
| 登录 | `/api/v1/auth/login` | 200 |
| 注册 | `/api/v1/auth/register` | 200 |
| 获取用户 | `/api/v1/auth/me` | 200 |
| 创建项目 | `/api/v1/projects/` | 200 |
| 项目列表 | `/api/v1/projects/` | 200 |
| 项目详情 | `/api/v1/projects/{id}` | 200 |
| 上传媒体 | `/api/v1/media/upload` | 200 |
| 媒体列表 | `/api/v1/media/` | 200 |
| 预签名 URL | `/api/v1/media/{id}/presign` | 200 |
| 创建渲染 | `/api/v1/render/` | 200 |
| 查询渲染 | `/api/v1/render/{id}` | 200 |
| 取消渲染 | `/api/v1/render/{id}/cancel` | 200 |
| 协作状态 | `/api/v1/collab/status` | 200 |
| Socket.IO polling | `/socket.io/?EIO=4&transport=polling` | 200 |
| 删除媒体 | `/api/v1/media/{id}` | 204 |
| 删除项目 | `/api/v1/projects/{id}` | 204 |

### Socket.IO WebSocket 连接测试

在 `http://localhost:8000/health` 页面通过 CDN 加载 Socket.IO 客户端：

| 测试项 | 结果 |
|--------|------|
| WebSocket 连接 | sid=EHabOK_j2y852T6-AAAD |
| Ping/Pong 延迟 | RTT = 1ms |
| 客户端主动断开 | reason=io client disconnect |

---

## 关键配置变更

### 1. Vite 代理配置

[frontend/vite.config.ts](../frontend/vite.config.ts) 新增代理：

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    },
    '/socket.io': {
      target: 'http://localhost:8000',
      changeOrigin: true,
      ws: true,
    },
  },
},
```

### 2. API 客户端路径

[frontend/src/utils/apiClient.ts](../frontend/src/utils/apiClient.ts) 改为相对路径：

```typescript
const API_BASE = '/api/v1';
const WS_BASE = '';  // Socket.IO 通过 Vite 代理
```

### 3. CORS 配置

[backend/.env](../backend/.env) 更新：

```env
CORS_ORIGINS=["http://localhost:5173","http://localhost:8000","http://192.168.10.76:5173"]
```

---

## 已知限制

1. **Vite 代理 + Socket.IO WebSocket**：Vite 代理对 Socket.IO POST 请求存在兼容问题（返回 400），WebSocket 升级也会失败。生产环境应使用 Nginx 反向代理或直接连接后端。
2. **浏览器端 Socket.IO 事件广播**：双客户端同页面测试时，`user_joined` 事件存在时序问题，需通过后端日志确认广播正常。
3. **开发模式内存存储**：当前认证、项目、媒体、渲染均使用内存字典存储，服务重启后数据丢失。生产环境需切换到 PostgreSQL。

---

## 运行测试

```bash
# 1. 启动后端
cd backend && ./venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 2. 启动前端
cd frontend && npx vite --host 0.0.0.0

# 3. 运行 Shell E2E 测试
bash tests/e2e_test.sh

# 预期输出：38/38 通过, 0 失败
```
