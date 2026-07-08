# AI Canvas Flow — 下一迭代功能设计

> 日期: 2026-07-08
> 状态: 待审核

## 概述

基于 DEVELOPMENT_ROADMAP.md 和 PRD.md 的差距分析，本迭代覆盖 6 大功能模块，按交付顺序排列。

---

## F1: 设置页存储用量 API 对接

### 现状
Settings.tsx「存储用量」标签页使用硬编码假数据（10GB 配额、随机已用量），无法反映真实存储状态。

### 设计

**后端新增端点**: `GET /api/v1/media/storage-stats`

返回:
```json
{
  "quota_bytes": 10737418240,   // 10 GB
  "used_bytes": 3145728000,
  "file_count": 42
}
```

实现逻辑: 聚合 `media_assets` 表 `SUM(file_size) WHERE owner_id = current_user`，配额从配置读取（默认 10GB）。

**前端修改**: Settings.tsx StorageTab 组件，将硬编码数据替换为 `mediaApi.getStorageStats()` 调用。

### 涉及文件
- `backend/app/api/media.py` — 新增端点
- `backend/app/services/media_service.py` — 聚合查询
- `frontend/src/pages/Settings.tsx` — StorageTab 组件
- `frontend/src/utils/apiClient.ts` — 新增 API 方法

---

## F2: 处理/控制节点状态提示

### 现状
PropertyPanel 中处理节点（upscale/style_transfer/remove_bg/extend_image）显示"演示模式"提示；控制节点（condition/loop/merge）显示"不可执行"提示。两者均无视觉区分。

### 设计

**处理节点**: 移除"演示模式"提示。这些节点已有后端 `render` task_type 支持（模拟渲染），改为显示正常执行按钮，与 AI 推理节点一致。

**控制节点**: 添加「控制节点」徽章 + 提示"此节点用于工作流逻辑控制，不可单独执行"，并禁用执行按钮。

### 涉及文件
- `frontend/src/components/panels/PropertyPanelWithHistory.tsx` — 调整条件分支

---

## F3: 视频导出/合成

### 现状
PRD 规划的"最终成片预览与导出"尚未实现。用户无法将时间轴上的多轨道素材合成为最终视频。

### 设计

**后端新增端点**: `POST /api/v1/render/export`

请求体:
```json
{
  "project_id": "uuid",
  "format": "mp4",
  "timeline_data": { "tracks": [...], "duration": 30 }
}
```

实现逻辑:
1. 按 timeline_data 排序所有 clip
2. 下载所有 clip 对应的 MinIO 素材到临时目录
3. 生成 FFmpeg 命令：多轨道混流（视频叠加 + 音频混合 + 字幕烧录）
4. Celery 异步执行 FFmpeg，进度写回 render_tasks
5. 输出上传 MinIO，创建 MediaAsset，更新 task result_url

**前端新增**:
- 时间轴区域添加「导出」按钮
- 弹窗选择格式（MP4/MOV/WebM）+ 分辨率（720p/1080p/4K）
- 进度条显示 + 完成后下载

### 涉及文件
- `backend/app/api/render.py` — 新增端点
- `backend/app/tasks/render_tasks.py` — FFmpeg 合成任务
- `backend/app/services/export_service.py` — 新建导出服务
- `frontend/src/components/timeline/Timeline.tsx` — 导出按钮
- `frontend/src/components/ExportModal.tsx` — 新建导出弹窗
- `frontend/src/utils/apiClient.ts` — 新增 API

---

## F4: 手动版本标记

### 现状
project_snapshots 表已有 `source` 字段（auto/manual），但前端无入口创建 manual 快照。

### 设计

**后端**: 已有 `POST /api/v1/projects/{id}/snapshots` 支持 `source: "manual"`，无需修改。

**前端新增**:
- EditorLayout 工具栏「保存」按钮旁新增下拉菜单：「保存」→「创建版本快照」
- 点击后弹出输入框填写版本名称（如"v1.0 确认版"）
- 调用 `snapshotApi.create()` 并传入 `source: "manual"` + `name`
- 自动保存恢复时仅恢复 auto 快照，manual 快照作为永久标记

### 涉及文件
- `backend/app/models/project_snapshot.py` — 新增 `name` 字段
- `backend/app/api/snapshots.py` — schema 扩展
- `frontend/src/components/EditorLayout.tsx` — 保存下拉菜单
- `frontend/src/components/VersionSnapshotModal.tsx` — 新建版本命名弹窗

---

## F5: 协作者权限管理

### 现状
所有在线用户均可编辑，无权限分级。PRD 要求 owner/editor/viewer 三级权限。

### 设计

**后端新增表**: `project_collaborators`

| 字段 | 类型 | 说明 |
|------|------|------|
| project_id | UUID FK | 项目 |
| user_id | UUID FK | 用户 |
| role | ENUM | owner/editor/viewer |
| created_at | timestamp | 加入时间 |

**后端新增端点**:
- `GET /api/v1/projects/{id}/collaborators` — 协作者列表
- `PUT /api/v1/projects/{id}/collaborators/{uid}` — 修改权限
- `DELETE /api/v1/projects/{id}/collaborators/{uid}` — 移除协作者

**权限中间件**: 在 WebSocket 事件处理中检查 role，viewer 只能接收广播不可发送变更。

**前端**:
- 协作者面板（EditorLayout 顶部头像区域）点击展开详情
- owner 可修改权限、移除协作者

### 涉及文件
- `backend/app/models/project_collaborator.py` — 新建模型
- `backend/app/api/collaboration.py` — 新建路由
- `backend/app/ws/collaboration.py` — 权限检查
- `frontend/src/components/CollaboratorPanel.tsx` — 新建面板
- `frontend/src/components/EditorLayout.tsx` — 接入面板

---

## F6: 邀请链接

### 现状
无法分享项目给其他用户。PRD 要求"支持生成带过期时间和权限级别的邀请链接"。

### 设计

**后端新增表**: `project_invitations`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 邀请 ID |
| project_id | UUID FK | 项目 |
| token | VARCHAR(64) | 唯一邀请码 |
| role | ENUM | editor/viewer |
| expires_at | TIMESTAMP | 过期时间 |
| created_by | UUID FK | 创建者 |
| used_by | UUID FK NULL | 使用者 |

**后端新增端点**:
- `POST /api/v1/projects/{id}/invitations` — 生成邀请链接（参数：role、expires_in_hours）
- `POST /api/v1/invitations/{token}/accept` — 接受邀请
- `GET /api/v1/invitations/{token}` — 查看邀请信息（无需登录）

**前端**:
- 协作者面板添加「邀请」按钮
- 弹窗选择权限 + 有效期（1h/24h/7d/永久）
- 生成可复制的链接 `http://host/invite/{token}`
- 受邀者打开链接 → 登录 → 自动加入项目 → 跳转编辑器

### 涉及文件
- `backend/app/models/project_invitation.py` — 新建模型
- `backend/app/api/invitations.py` — 新建路由
- `frontend/src/components/InviteModal.tsx` — 新建邀请弹窗
- `frontend/src/pages/AcceptInvite.tsx` — 新建接受邀请页
- `frontend/src/App.tsx` — 新增路由

---

## 交付顺序

```
Phase 1 (快速交付):  F1 + F2 + F4
                      ↑ 体验打磨，1-2天
Phase 2 (核心功能):  F3
                      ↑ 视频导出闭环，2-3天
Phase 3 (协作增强):  F5 + F6
                      ↑ 权限+邀请，2-3天
```

## 验证标准

| 功能 | 验证方式 |
|------|---------|
| F1 | 设置页显示真实存储用量，进度条颜色随百分比变化 |
| F2 | 处理节点可执行，控制节点禁用执行并显示提示 |
| F3 | 时间轴3个clip（图片+视频+音频）→ 导出MP4 → 下载可播放 |
| F4 | 创建命名快照 → 刷新页面 → 快照列表显示名称 |
| F5 | viewer 用户尝试编辑 → WebSocket 拒绝 → UI 提示无权限 |
| F6 | 生成邀请链接 → 新用户访问 → 加入项目 → 跳转编辑器 |
