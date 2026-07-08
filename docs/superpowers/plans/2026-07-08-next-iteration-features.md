# 下一迭代功能实施计划 (F1-F6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 6 大功能模块，覆盖存储统计、节点提示、视频导出、版本快照、协作权限、邀请链接

**Architecture:** 后端 FastAPI 新增 3 个 API 模块 + 2 张数据库表；前端新增 4 个组件 + 修改 6 个现有组件；按 Phase 1→2→3 顺序交付

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL + Celery + FFmpeg + React + TypeScript + Zustand

## Global Constraints

- 后端 API 必须持久化到 PostgreSQL，禁止内存存储
- 前端使用 Vite + React 18 + TypeScript
- git commit 使用中文简短描述
- Celery 任务必须创建自己的 async engine + session factory
- 所有新增 API 需要在 router.py 注册

---

## Phase 1: 快速交付 (F1 + F2 + F4)

### Task 1: F1 — 存储用量 API

**Files:**
- Modify: `backend/app/api/media.py`
- Modify: `frontend/src/utils/apiClient.ts`
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Produces: `GET /api/v1/media/storage-stats` → `{ quota_bytes: int, used_bytes: int, file_count: int }`
- Produces: `mediaApi.getStorageStats()` 前端方法

- [ ] **Step 1: 后端新增存储统计端点**

在 `backend/app/api/media.py` 中添加：

```python
@router.get("/storage-stats", summary="获取用户存储用量统计")
async def get_storage_stats(db: DBSession, user: CurrentUser):
    from sqlalchemy import func
    from app.models.media_asset import MediaAsset
    from app.core.config import settings
    
    result = await db.execute(
        select(func.coalesce(func.sum(MediaAsset.file_size), 0), func.count(MediaAsset.id))
        .where(MediaAsset.owner_id == uuid.UUID(user))
    )
    used_bytes, file_count = result.one()
    
    quota_bytes = getattr(settings, 'STORAGE_QUOTA_BYTES', 10 * 1024 * 1024 * 1024)  # 默认 10GB
    
    return {
        "quota_bytes": quota_bytes,
        "used_bytes": int(used_bytes),
        "file_count": file_count,
    }
```

- [ ] **Step 2: 前端 apiClient 新增方法**

在 `frontend/src/utils/apiClient.ts` 的 `mediaApi` 对象中添加：

```typescript
getStorageStats: async (): Promise<{ quota_bytes: number; used_bytes: number; file_count: number }> => {
  const res = await apiClient.get('/media/storage-stats');
  return res.data;
},
```

- [ ] **Step 3: 前端 Settings.tsx 替换硬编码数据**

在 Settings.tsx 的 StorageTab 组件中，将硬编码的 quota/used/fileCount 替换为 API 调用：

```typescript
const [stats, setStats] = useState<{ quota_bytes: number; used_bytes: number; file_count: number } | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  mediaApi.getStorageStats()
    .then(setStats)
    .catch(() => {})
    .finally(() => setLoading(false));
}, []);

const quotaGB = stats ? stats.quota_bytes / (1024**3) : 10;
const usedGB = stats ? stats.used_bytes / (1024**3) : 0;
const percentage = stats ? (stats.used_bytes / stats.quota_bytes) * 100 : 0;
```

- [ ] **Step 4: 验证**

启动后端，调用 `curl -H "Authorization: Bearer <token>" http://localhost:8000/api/v1/media/storage-stats`，确认返回真实数据。

- [ ] **Step 5: 提交**

```bash
git add backend/app/api/media.py frontend/src/utils/apiClient.ts frontend/src/pages/Settings.tsx
git commit -m "实现存储用量API对接，替换硬编码数据"
```

---

### Task 2: F2 — 处理/控制节点状态提示

**Files:**
- Modify: `frontend/src/components/panels/PropertyPanelWithHistory.tsx`

**Interfaces:**
- Consumes: 现有节点类型分类（input/ai_inference/processing/control/output）

- [ ] **Step 1: 修改 PropertyPanelWithHistory 处理节点逻辑**

找到处理节点的"演示模式"提示分支，将其改为与 AI 推理节点一致的正常执行按钮。具体修改：

将处理节点的特殊提示移除，使其走通用的 AI 推理/处理节点渲染分支（显示执行按钮和参数编辑）。

- [ ] **Step 2: 添加控制节点提示**

在控制节点（condition/loop/merge）的渲染分支中，添加：
- 「控制节点」徽章（紫色标签）
- 提示文字："此节点用于工作流逻辑控制，不可单独执行"
- 禁用执行按钮

- [ ] **Step 3: 验证**

在编辑器中分别选中处理节点和控制节点，确认：
- 处理节点：显示执行按钮，无"演示模式"提示
- 控制节点：显示「控制节点」徽章 + 提示，无执行按钮

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/panels/PropertyPanelWithHistory.tsx
git commit -m "处理节点移除演示提示，控制节点添加不可执行提示"
```

---

### Task 3: F4 — 手动版本标记

**Files:**
- Modify: `backend/app/models/project_snapshot.py`
- Modify: `backend/app/api/snapshots.py`
- Modify: `frontend/src/components/EditorLayout.tsx`

**Interfaces:**
- Produces: `ProjectSnapshot.name` 字段
- Produces: `SnapshotCreateRequest.name` 可选字段
- Produces: 前端「创建版本快照」入口

- [ ] **Step 1: 后端 project_snapshot.py 新增 name 字段**

在 ProjectSnapshot 模型中添加：
```python
name: Mapped[str | None] = mapped_column(String(100), nullable=True, comment="版本快照名称")
```

- [ ] **Step 2: 后端 snapshots.py schema 扩展**

在 SnapshotCreateRequest 中添加：
```python
name: str | None = None
```

在 SnapshotResponse 中添加：
```python
name: str | None = None
```

- [ ] **Step 3: 数据库迁移**

创建 Alembic 迁移添加 name 列：
```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "add_name_to_project_snapshots"
.venv/bin/alembic upgrade head
```

- [ ] **Step 4: 前端 EditorLayout 保存下拉菜单**

将「保存」按钮改为下拉菜单，包含：
- 「保存」— 调用 saveCurrentProject()（原有行为）
- 「创建版本快照」— 弹出命名弹窗

弹窗内容：输入框（版本名称，如"v1.0 确认版"）+ 确认/取消按钮

确认时调用：
```typescript
await snapshotApi.create(projectId, { source: 'manual', name: versionName });
```

- [ ] **Step 5: 验证**

1. 创建版本快照，输入名称
2. 刷新页面，触发崩溃恢复
3. 确认手动快照在列表中显示名称

- [ ] **Step 6: 提交**

```bash
git add backend/app/models/project_snapshot.py backend/app/api/snapshots.py frontend/src/components/EditorLayout.tsx
git commit -m "实现手动版本快照：新增name字段和创建入口"
```

---

## Phase 2: 核心功能 (F3)

### Task 4: F3 — 视频导出后端

**Files:**
- Create: `backend/app/services/export_service.py`
- Modify: `backend/app/api/render.py`
- Modify: `backend/app/tasks/render_tasks.py`

**Interfaces:**
- Produces: `POST /api/v1/render/export` 端点
- Produces: Celery task `run_export_task`

- [ ] **Step 1: 创建 export_service.py**

```python
"""视频导出服务：FFmpeg 多轨混流合成"""
import tempfile
import os
import subprocess
import asyncio
from pathlib import Path

async def compose_video(
    clips: list[dict],      # [{url, start, end, track_type, media_type}]
    output_format: str,     # mp4/mov/webm
    resolution: str,        # 720p/1080p/4k
    duration: float,
    download_func,          # async (url) -> local_path
    progress_callback,     # async (percent) -> None
) -> Path:
    """将时间轴素材合成为最终视频"""
    # 1. 下载所有素材到临时目录
    tmp_dir = tempfile.mkdtemp()
    local_paths = []
    for i, clip in enumerate(clips):
        local_path = await download_func(clip["url"], tmp_dir, f"clip_{i}")
        local_paths.append(local_path)
        await progress_callback(int((i + 1) / len(clips) * 30))  # 0-30%: 下载
    
    # 2. 生成 FFmpeg 输入文件列表
    resolution_map = {"720p": "1280:720", "1080p": "1920:1080", "4k": "3840:2160"}
    scale = resolution_map.get(resolution, "1920:1080")
    
    # 3. 构建 FFmpeg 命令
    video_clips = [(c, p) for c, p in zip(clips, local_paths) if c["track_type"] == "video"]
    audio_clips = [(c, p) for c, p in zip(clips, local_paths) if c["track_type"] == "audio"]
    
    output_path = os.path.join(tmp_dir, f"output.{output_format}")
    
    cmd = ["ffmpeg", "-y"]
    
    # 视频输入
    for clip, path in video_clips:
        cmd += ["-i", str(path)]
    
    # 音频输入
    for clip, path in audio_clips:
        cmd += ["-i", str(path)]
    
    # 滤镜：缩放 + 叠加
    vfilters = []
    for i, (clip, path) in enumerate(video_clips):
        vfilters.append(f"[{i}:v]scale={scale},setpts=PTS-STARTPTS[v{i}]")
    
    # 混流
    if len(video_clips) > 1:
        inputs = "".join(f"[v{i}]" for i in range(len(video_clips)))
        vfilters.append(f"{inputs}concat=n={len(video_clips)}:v=1:a=0[outv]")
    elif len(video_clips) == 1:
        vfilters.append(f"[v0]copy[outv]")
    
    filter_complex = ";".join(vfilters)
    
    cmd += ["-filter_complex", filter_complex, "-map", "[outv]"]
    
    # 音频混合
    if audio_clips:
        audio_idx_start = len(video_clips)
        for i, (clip, path) in enumerate(audio_clips):
            cmd += ["-map", f"{audio_idx_start + i}:a"]
    
    cmd += ["-c:v", "libx264", "-c:a", "aac", "-t", str(duration), str(output_path)]
    
    # 4. 执行 FFmpeg
    process = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    
    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {stderr.decode()}")
    
    await progress_callback(90)  # 90%: 合成完成
    
    return Path(output_path)
```

- [ ] **Step 2: render.py 新增导出端点**

```python
class ExportRequest(BaseModel):
    project_id: str
    format: str = "mp4"  # mp4/mov/webm
    resolution: str = "1080p"  # 720p/1080p/4k

@router.post("/export", summary="导出时间轴视频")
async def export_video(req: ExportRequest, db: DBSession, user: CurrentUser):
    # 验证项目权限
    project = await db.get(Project, uuid.UUID(req.project_id))
    if not project or str(project.owner_id) != user:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    # 创建导出任务
    task = RenderTask(
        project_id=uuid.UUID(req.project_id),
        owner_id=uuid.UUID(user),
        task_type="export",
        status="pending",
        progress=0,
        node_params={"format": req.format, "resolution": req.resolution},
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    
    # 触发 Celery
    from app.tasks.render_tasks import run_export_task
    run_export_task.delay(str(task.id))
    
    return {"task_id": str(task.id), "status": "pending"}
```

- [ ] **Step 3: render_tasks.py 新增导出任务**

```python
@celery_app.task(name="run_export_task")
def run_export_task(task_id: str):
    # 同 run_render_task 的 session 管理
    # 读取 task -> 获取 timeline_data -> 调用 export_service
    # 上传到 MinIO -> 更新 task result_url
    pass
```

- [ ] **Step 4: 前端 apiClient 新增导出方法**

```typescript
exportVideo: async (projectId: string, format: string, resolution: string): Promise<{ task_id: string; status: string }> => {
  const res = await apiClient.post('/render/export', { project_id: projectId, format, resolution });
  return res.data;
},
```

- [ ] **Step 5: 验证**

curl 调用导出端点，确认任务创建成功。

- [ ] **Step 6: 提交**

```bash
git add backend/app/services/export_service.py backend/app/api/render.py backend/app/tasks/render_tasks.py frontend/src/utils/apiClient.ts
git commit -m "实现视频导出后端：FFmpeg混流合成+Celery异步任务"
```

---

### Task 5: F3 — 视频导出前端

**Files:**
- Create: `frontend/src/components/ExportModal.tsx`
- Modify: `frontend/src/components/timeline/Timeline.tsx`

**Interfaces:**
- Consumes: `renderApi.exportVideo()` 方法
- Consumes: `renderApi.getTask()` 轮询进度

- [ ] **Step 1: 创建 ExportModal.tsx**

导出弹窗组件，包含：
- 格式选择：MP4 / MOV / WebM（下拉框）
- 分辨率选择：720p / 1080p / 4K（下拉框）
- 导出按钮 → 调用 API → 显示进度条 → 完成后下载按钮

- [ ] **Step 2: Timeline.tsx 添加导出按钮**

在时间轴工具栏区域添加「导出」按钮，点击打开 ExportModal。

- [ ] **Step 3: 验证**

MCP 测试：点击导出 → 选择格式 → 确认进度条显示 → 下载。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/ExportModal.tsx frontend/src/components/timeline/Timeline.tsx
git commit -m "实现视频导出前端：导出弹窗+进度+下载"
```

---

## Phase 3: 协作增强 (F5 + F6)

### Task 6: F5 — 协作者权限管理后端

**Files:**
- Create: `backend/app/models/project_collaborator.py`
- Modify: `backend/app/api/router.py`
- Create: `backend/app/api/collaboration.py`
- Modify: `backend/app/ws/collaboration.py`

**Interfaces:**
- Produces: `project_collaborators` 表
- Produces: CRUD 端点（GET/PUT/DELETE）
- Produces: WebSocket 权限检查

- [ ] **Step 1: 创建 ProjectCollaborator 模型**

```python
class ProjectCollaborator(Base):
    __tablename__ = "project_collaborators"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20), default="editor")  # owner/editor/viewer
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
```

- [ ] **Step 2: 创建 collaboration.py API 路由**

3 个端点：GET 列表、PUT 修改权限、DELETE 移除

- [ ] **Step 3: WebSocket 权限检查**

在 `collaboration.py` 的 node_update/edge_update 事件处理中，检查用户角色，viewer 的变更请求返回错误。

- [ ] **Step 4: 注册路由 + 迁移**

- [ ] **Step 5: 验证 + 提交**

```bash
git add backend/app/models/project_collaborator.py backend/app/api/collaboration.py backend/app/ws/collaboration.py
git commit -m "实现协作者权限管理：三级角色+WebSocket权限检查"
```

---

### Task 7: F5 — 协作者权限管理前端

**Files:**
- Create: `frontend/src/components/CollaboratorPanel.tsx`
- Modify: `frontend/src/components/EditorLayout.tsx`
- Modify: `frontend/src/utils/apiClient.ts`

**Interfaces:**
- Consumes: 协作者 CRUD API
- Produces: CollaboratorPanel 组件

- [ ] **Step 1: apiClient 新增协作者 API 方法**

- [ ] **Step 2: 创建 CollaboratorPanel 组件**

显示协作者列表 + 权限修改下拉 + 移除按钮（仅 owner 可操作）

- [ ] **Step 3: EditorLayout 接入面板**

在线用户头像区域点击展开 CollaboratorPanel

- [ ] **Step 4: 验证 + 提交**

```bash
git add frontend/src/components/CollaboratorPanel.tsx frontend/src/components/EditorLayout.tsx frontend/src/utils/apiClient.ts
git commit -m "实现协作者权限管理前端：面板+权限修改+移除"
```

---

### Task 8: F6 — 邀请链接后端

**Files:**
- Create: `backend/app/models/project_invitation.py`
- Create: `backend/app/api/invitations.py`
- Modify: `backend/app/api/router.py`

**Interfaces:**
- Produces: `project_invitations` 表
- Produces: POST 生成邀请 / POST 接受邀请 / GET 查看邀请

- [ ] **Step 1: 创建 ProjectInvitation 模型**

```python
class ProjectInvitation(Base):
    __tablename__ = "project_invitations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
    expires_at: Mapped[datetime] = mapped_column(nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    used_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
```

- [ ] **Step 2: 创建 invitations.py API 路由**

3 个端点：
- `POST /projects/{id}/invitations` — 生成 token（secrets.token_urlsafe(32)），设置过期时间
- `GET /invitations/{token}` — 查看邀请信息（项目名、创建者、角色、是否过期）
- `POST /invitations/{token}/accept` — 验证 token → 创建 ProjectCollaborator → 跳转

- [ ] **Step 3: 注册路由 + 迁移**

- [ ] **Step 4: 验证 + 提交**

```bash
git add backend/app/models/project_invitation.py backend/app/api/invitations.py
git commit -m "实现邀请链接后端：生成/查看/接受邀请"
```

---

### Task 9: F6 — 邀请链接前端

**Files:**
- Create: `frontend/src/components/InviteModal.tsx`
- Create: `frontend/src/pages/AcceptInvite.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/CollaboratorPanel.tsx`

**Interfaces:**
- Consumes: 邀请 API
- Produces: InviteModal + AcceptInvite 页面

- [ ] **Step 1: apiClient 新增邀请 API 方法**

- [ ] **Step 2: 创建 InviteModal 组件**

权限选择 + 有效期选择 + 生成链接 + 复制按钮

- [ ] **Step 3: 创建 AcceptInvite 页面**

访问 `/invite/{token}` → 登录 → 接受邀请 → 跳转编辑器

- [ ] **Step 4: App.tsx 新增路由**

`/invite/:token` → AcceptInvite

- [ ] **Step 5: CollaboratorPanel 添加邀请按钮**

- [ ] **Step 6: 验证 + 提交**

```bash
git add frontend/src/components/InviteModal.tsx frontend/src/pages/AcceptInvite.tsx frontend/src/App.tsx frontend/src/components/CollaboratorPanel.tsx
git commit -m "实现邀请链接前端：生成/复制/接受邀请"
```
