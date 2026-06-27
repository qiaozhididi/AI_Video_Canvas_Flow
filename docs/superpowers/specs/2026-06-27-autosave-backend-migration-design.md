# 编辑器自动保存后端化 — 设计文档

> 日期: 2026-06-27
> 状态: 已批准

## 目标

将编辑器自动保存（autoSaveStore）从 localStorage 切换到后端 PostgreSQL，实现跨设备一致、崩溃恢复可靠的快照体系。保留现有 2s 操作防抖 + 30s 定时双防抖策略与 5 快照上限。

## 背景

当前 `autoSaveStore.ts` 已实现双防抖与 5 快照上限，但快照仅存浏览器 localStorage，存在以下问题：

1. **跨设备失效**：用户换设备登录后无法获取历史快照
2. **崩溃恢复不可靠**：浏览器崩溃/清缓存会丢失全部快照
3. **容量受限**：localStorage ~5-10MB，复杂工作流易超限
4. **违反硬约束**：项目规范要求"所有 API 数据必须持久化到 PostgreSQL；禁止内存存储"

手动保存路径（`projectStore.saveCurrentProject()`）已对接后端 `workflowApi.save()` + `projectApi.update()`，本次改造不涉及手动保存逻辑，仅改造自动保存的快照存储层。

## 架构

**快照与实际状态分离**：

- 自动保存（`saveNow('auto')`）仅向后端 `project_snapshots` 表插入快照记录，不修改项目实际 nodes/edges
- 手动保存（`saveCurrentProject()`）仍调 `workflowApi.save()` 全量替换实际 nodes/edges
- 崩溃恢复时，用户确认后调专用 `POST /snapshots/{id}/restore` 端点，后端在单事务内将快照数据写入实际 nodes/edges 并刷新 `project.updated_at`

这样设计的理由：自动保存每 2s 触发一次，若同时全量重写 nodes/edges 表会对 DB 造成不必要的压力；快照表仅追加写入，负载更低。

## 数据库新增表

### project_snapshots

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | UUID | PK | |
| project_id | UUID | FK projects.id ON DELETE CASCADE | 项目删除时级联清理快照 |
| owner_id | UUID | FK users.id | |
| snapshot_data | JSONB | NOT NULL | `{nodes: [...], edges: [...], timelineData: {...}}` |
| source | VARCHAR(16) | NOT NULL | `auto` / `manual` |
| label | VARCHAR(128) | NULL | 手动快照标签 |
| created_at | TIMESTAMP | DEFAULT now() | 用于崩溃恢复对比 |

**索引**：
- `(project_id, source, created_at DESC)` — 列表查询 + 5 快照上限清理
- `owner_id` — 用户隔离查询

**5 快照上限策略**：
- 仅限制 `source='auto'` 的快照数量 ≤ 5
- `source='manual'` 的命名快照不计数，由用户手动管理
- 插入 auto 快照前，查询该项目 auto 快照数，>=5 则删除最旧的

## 后端 API

### 新增端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/projects/{project_id}/snapshots` | POST | 创建快照 |
| `/api/v1/projects/{project_id}/snapshots` | GET | 列表（可选 `?source=auto\|manual` 筛选） |
| `/api/v1/projects/{project_id}/snapshots/latest` | GET | 获取最新快照（崩溃恢复检测用） |
| `/api/v1/snapshots/{snapshot_id}` | GET | 获取快照详情 |
| `/api/v1/snapshots/{snapshot_id}` | DELETE | 删除快照 |
| `/api/v1/snapshots/{snapshot_id}/restore` | POST | 恢复快照到实际 nodes/edges |

### POST /projects/{project_id}/snapshots — 创建快照

**请求体：**
```json
{
  "source": "auto",
  "label": null,
  "snapshot_data": {
    "nodes": [...],
    "edges": [...],
    "timelineData": {...}
  }
}
```

**逻辑：**
1. 校验 project 属于当前用户
2. 若 `source='auto'`：查询该项目 auto 快照数，>=5 则删除最旧的
3. 插入新快照记录
4. 返回快照对象

**响应 200：**
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "owner_id": "uuid",
  "source": "auto",
  "label": null,
  "snapshot_data": {...},
  "created_at": "2026-06-27T..."
}
```

### GET /projects/{project_id}/snapshots/latest — 获取最新快照

**逻辑：** 查询该项目最新一条快照（不限 source），无则返回 404。

**用途：** 前端 `checkRecovery()` 调用，对比 `snapshot.created_at` vs `project.updated_at`。

### POST /snapshots/{snapshot_id}/restore — 恢复快照

**逻辑（单事务）：**
1. 校验快照属于当前用户
2. 读取 `snapshot.snapshot_data`
3. 删除项目现有全部 nodes/edges
4. 从 `snapshot_data.nodes` / `snapshot_data.edges` 插入新记录
5. 刷新 `project.updated_at = now()`
6. 提交事务

**响应 200：**
```json
{
  "restored": true,
  "project_id": "uuid",
  "nodes_count": 5,
  "edges_count": 4
}
```

## 前端改动

### apiClient.ts — 新增 snapshotApi

```typescript
export const snapshotApi = {
  create: (projectId: string, data: {
    source: 'auto' | 'manual';
    label?: string;
    snapshot_data: { nodes: any[]; edges: any[]; timelineData: any };
  }) => request<SnapshotResponse>(`/projects/${projectId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  list: (projectId: string, source?: 'auto' | 'manual') =>
    request<SnapshotResponse[]>(`/projects/${projectId}/snapshots${source ? `?source=${source}` : ''}`),
  getLatest: (projectId: string) =>
    request<SnapshotResponse>(`/projects/${projectId}/snapshots/latest`),
  get: (snapshotId: string) =>
    request<SnapshotResponse>(`/snapshots/${snapshotId}`),
  delete: (snapshotId: string) =>
    request<void>(`/snapshots/${snapshotId}`, { method: 'DELETE' }),
  restore: (snapshotId: string) =>
    request<{ restored: boolean; project_id: string; nodes_count: number; edges_count: number }>(
      `/snapshots/${snapshotId}/restore`,
      { method: 'POST' }
    ),
};
```

### autoSaveStore.ts 改造

**移除：**
- `loadSnapshotsFromStorage()` / `saveSnapshotsToStorage()` / `AUTOSAVE_KEY` 常量
- localStorage 全部读写逻辑

**保留（已实现）：**
- `DEBOUNCE_DELAY = 2000` / `AUTOSAVE_INTERVAL = 30000` / `SNAPSHOT_LIMIT = 5`
- `markDirty()` 的 2s 防抖逻辑
- `startAutoSave()` 的 30s 定时逻辑
- `stopAutoSave()` 的停止前保存逻辑

**改造：**

| 方法 | 改造内容 |
|------|----------|
| `saveNow()` | 改为 async；构建 snapshot_data（nodes/edges/timelineData）；调 `snapshotApi.create()`；不再写 localStorage |
| `checkRecovery()` | 改为 async；调 `snapshotApi.getLatest(projectId)`；对比 `snapshot.created_at` vs `project.updatedAt` |
| `restoreSnapshot()` | 改为 async；调 `snapshotApi.restore(id)`；成功后调 `loadProjectToCanvas()` 刷新本地 stores |
| `discardRecovery()` | 改为 async；调 `snapshotApi.delete(id)` 清理后端快照 |
| `clearSnapshots()` | 改为 async；遍历当前项目快照逐个调 `snapshotApi.delete()`（不新增批量端点，保持 API 简洁） |
| 初始化 | `snapshots` 状态初始为 `[]`，由 `projectStore.loadProjectToCanvas()` 加载时填充 |

### projectStore.ts 改造

`loadProjectToCanvas()` 在加载 nodes/edges 后，额外调用：
```typescript
const snapshots = await snapshotApi.list(projectId);
useAutoSaveStore.setState({ snapshots });
```

### 类型定义

新增 `SnapshotResponse` 类型到 `frontend/src/types/api.ts` 或 `apiClient.ts`：
```typescript
export interface SnapshotResponse {
  id: string;
  project_id: string;
  owner_id: string;
  source: 'auto' | 'manual';
  label: string | null;
  snapshot_data: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    timelineData: TimelineData;
  };
  created_at: string;
}
```

## 崩溃恢复流程

```
用户打开项目
  → projectStore.loadProjectToCanvas(projectId)
      → 加载实际 nodes/edges 到 canvasStore
      → 调 snapshotApi.list() 填充 autoSaveStore.snapshots
  → autoSaveStore.checkRecovery()
      → snapshotApi.getLatest(projectId)
      → 对比 snapshot.created_at vs project.updatedAt
      → snapshot 更新 → set recoverySnapshot，返回快照
  → 编辑器渲染恢复对话框
  → 用户点"恢复"
      → snapshotApi.restore(snapshot.id)
      → loadProjectToCanvas() 重新加载实际 nodes/edges
      → markClean()
  → 用户点"丢弃"
      → snapshotApi.delete(snapshot.id)
      → 清除 recoverySnapshot
```

## 错误处理

- 快照创建失败（网络/DB 错误）→ `saveNow()` catch 后 console.error，不阻塞用户操作；`isSaving` 复位
- `getLatest()` 返回 404（无快照）→ `checkRecovery()` 返回 null，正常进入编辑器
- `restore()` 失败 → Toast "恢复失败，请重试"，保留对话框
- `delete()` 失败 → 静默失败（不影响主流程）
- 项目无 currentProject → `saveNow()` 跳过（与现有逻辑一致）

## 不在范围内

- **timelineData 持久化**：timelineStore 仍未对接后端，快照中 timelineData 仅前端内存态，恢复时还原到内存
- **快照 diff/增量存储**：全量 JSONB 存储，简化实现；后续可优化
- **快照分享/导出**：不支持
- **手动保存改造**：`saveCurrentProject()` 逻辑不变
- **WebSocket 实时同步快照**：不在本阶段

## 涉及文件

**后端新增：**
- `backend/app/models/project_snapshot.py` — ProjectSnapshot 模型
- `backend/app/schemas/snapshot.py` — Pydantic schemas
- `backend/app/api/snapshots.py` — 快照 CRUD + restore 路由
- `backend/alembic/versions/xxxx_add_project_snapshots_table.py` — 迁移脚本

**后端修改：**
- `backend/app/database.py` — 注册新表
- `backend/app/api/router.py` — 挂载 snapshots 路由
- `backend/app/models/__init__.py` — 导出新模型

**前端修改：**
- `frontend/src/utils/apiClient.ts` — 新增 `snapshotApi` + `SnapshotResponse` 类型
- `frontend/src/stores/autoSaveStore.ts` — 移除 localStorage，改 async 调后端
- `frontend/src/stores/projectStore.ts` — `loadProjectToCanvas()` 加载快照列表
