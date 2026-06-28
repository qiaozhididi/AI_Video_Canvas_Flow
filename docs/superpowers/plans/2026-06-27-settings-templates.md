# 实施计划：设置页持久化 + 模板市场

> 创建时间: 2026-06-27
> 分支: feature/settings-templates
> 基线: main (da44664)

## 目标

1. **功能 A - 设置页持久化**：用户可修改个人信息（用户名/邮箱/头像 URL）并持久化到后端
2. **功能 B - 模板市场**：用户可浏览官方/社区模板，一键克隆为新项目；可将自己的项目发布为模板

## 全局约束

- 后端所有数据必须持久化到 PostgreSQL（禁止内存存储）
- 前端 API 客户端使用相对路径 + Vite 代理
- Git commit message 必须用中文简短描述
- 模板复用 projects 表（is_template 标记），不新建独立表
- Alembic 迁移需包含 seed 官方模板数据
- 项目删除级联清理 workflow_nodes/edges/project_snapshots（已有逻辑，模板项目复用）

## 任务分解

### 功能 A：设置页持久化

#### Task 1: 后端 — auth.py 新增 PUT /me 端点

**Files:**
- `backend/app/api/auth.py`（修改）
- `backend/app/schemas/auth.py`（修改，新增 UserUpdateRequest）

**Steps:**
1. 在 `schemas/auth.py` 新增 `UserUpdateRequest`（username?, email?, avatar_url? 均可选）
2. `UserResponse` 扩展 `avatar_url: str | None` 字段
3. auth.py 新增 `PUT /me` 端点：
   - 接收 `UserUpdateRequest`
   - 如修改 username，校验唯一性（排除当前用户）
   - 如修改 email，校验唯一性（排除当前用户）
   - 更新 User 记录，返回 `UserResponse`
4. `GET /me` 和 `register` 的 `UserResponse` 也返回 `avatar_url`

**验收：**
- `curl -X PUT /api/v1/auth/me -H "Authorization: Bearer <token>" -d '{"username":"newname"}'` 返回 200 + 更新后的用户信息
- 重复用户名返回 400
- 重复邮箱返回 400

---

#### Task 2: 前端 — Settings.tsx 个人信息对接后端

**Files:**
- `frontend/src/utils/apiClient.ts`（修改，authApi 新增 update + UserResponse 扩展）
- `frontend/src/pages/Settings.tsx`（修改，个人信息标签页对接）

**Steps:**
1. `apiClient.ts`:
   - `UserResponse` 类型新增 `avatar_url: string | null`
   - `authApi` 新增 `update(data: UserUpdateRequest)` 方法
   - 新增 `UserUpdateRequest` 类型
2. `Settings.tsx` 个人信息标签页：
   - `useEffect` 调 `authApi.getMe()` 加载真实用户数据
   - 表单字段：显示名称（username）、邮箱（email）、头像 URL（avatar_url）
   - "保存修改"按钮调 `authApi.update()`，成功后 toast 提示
   - 加载中显示 loading 状态

**验收：**
- 打开设置页，个人信息显示真实用户数据
- 修改用户名后点保存，刷新页面数据持久化
- tsc --noEmit 无错误

---

### 功能 B：模板市场

#### Task 3: 后端 — Project 模型新增模板字段 + Alembic 迁移 + seed

**Files:**
- `backend/app/models/project.py`（修改）
- `backend/alembic/versions/<hash>_add_template_fields_to_projects.py`（新建）

**Steps:**
1. Project 模型新增字段：
   - `is_template: bool`（默认 False，index）
   - `template_category: str | None`（如"官方"/"社区"，默认 None）
   - `template_tags: list | None`（JSON 数组，如 ["文生图", "图生视频"]，用 JSON 类型）
2. Alembic 迁移：
   - ALTER TABLE projects ADD COLUMN is_template BOOLEAN DEFAULT FALSE
   - ALTER TABLE projects ADD COLUMN template_category VARCHAR(32)
   - ALTER TABLE projects ADD COLUMN template_tags JSON
   - CREATE INDEX ix_projects_is_template ON projects (is_template)
3. Seed 3 个官方模板（is_template=True, template_category='官方'）：
   - "文生图工作流"：1 个 input 节点 + 1 个 ai_inference（ai_text2img）节点 + 1 条边
   - "图生视频工作流"：1 个 input 节点 + 1 个 ai_inference（ai_img2video）节点 + 1 条边
   - "文生图→图生视频"：1 个 input + 1 个 ai_text2img + 1 个 ai_img2video + 2 条边
   - 每个模板插入对应 workflow_nodes 和 workflow_edges
   - 模板的 owner_id 用系统用户（迁移时查询第一个 admin 用户，或创建 system 用户）

**验收：**
- 迁移成功执行，projects 表有新字段
- 查询 `SELECT * FROM projects WHERE is_template=true` 返回 3 条记录
- 每个模板有关联的 workflow_nodes

---

#### Task 4: 后端 — 新建 templates.py API + 挂载路由

**Files:**
- `backend/app/api/templates.py`（新建）
- `backend/app/api/router.py`（修改，挂载 templates 路由）
- `backend/app/schemas/project.py`（修改，新增 TemplateResponse）

**Steps:**
1. `schemas/project.py` 新增 `TemplateResponse`：
   - 继承 ProjectResponse 字段 + is_template/template_category/template_tags
2. 新建 `templates.py`：
   - `GET /templates/` — 获取模板列表（支持 q 搜索 name/tags，category 筛选）
     - 查询 `Project.where(is_template=True)`
     - 支持 `?q=keyword&category=官方` 查询参数
     - 返回 `list[TemplateResponse]`
   - `POST /templates/{template_id}/clone` — 克隆模板为新项目
     - 创建新 Project（name=f"{模板名} 副本", owner=当前用户, is_template=False）
     - 复制模板的 workflow_nodes（新节点 ID 加项目前缀避免冲突）
     - 复制模板的 workflow_edges（source/target 映射到新节点 ID）
     - 返回新项目的 `ProjectResponse`
   - `POST /projects/{project_id}/publish` — 将项目发布为模板
     - 校验项目属于当前用户
     - 设置 `is_template=True, template_category=body.category, template_tags=body.tags`
     - 返回 `TemplateResponse`
   - `DELETE /templates/{template_id}` — 取消模板发布（仅 owner）
     - 设置 `is_template=False, template_category=None, template_tags=None`
     - 返回 204
3. `router.py` 挂载 templates 路由

**验收：**
- `GET /api/v1/templates/` 返回 3 个官方模板
- `GET /api/v1/templates/?q=文生图` 返回匹配的模板
- `POST /api/v1/templates/{id}/clone` 创建新项目，含复制的 nodes/edges
- `POST /api/v1/projects/{id}/publish` 将项目标记为模板

---

#### Task 5: 前端 — Templates.tsx 重写对接后端

**Files:**
- `frontend/src/utils/apiClient.ts`（修改，新增 templateApi + TemplateResponse 类型）
- `frontend/src/pages/Templates.tsx`（重写）

**Steps:**
1. `apiClient.ts`:
   - 新增 `TemplateResponse` 类型（ProjectResponse + is_template/template_category/template_tags）
   - 新增 `templateApi`：
     - `list(params?: { q?: string; category?: string })` — GET /templates/
     - `clone(templateId: string)` — POST /templates/{id}/clone
     - `publish(projectId: string, data: { category: string; tags: string[] })` — POST /projects/{id}/publish
     - `unpublish(templateId: string)` — DELETE /templates/{id}
2. `Templates.tsx` 重写：
   - 移除 MOCK_TEMPLATES
   - `useEffect` 调 `templateApi.list()` 加载模板
   - 搜索框对接后端（debounce 300ms，调 `templateApi.list({ q })`）
   - 分类筛选（全部/官方/社区）
   - "导入"按钮调 `templateApi.clone()`，成功后 toast + 跳转编辑器
   - 加载/错误状态处理

**验收：**
- 打开模板市场，显示 3 个官方模板
- 搜索"文生图"过滤出匹配模板
- 点"导入"创建新项目并跳转编辑器
- tsc --noEmit 无错误

---

#### Task 6: 前端 — Home.tsx 新增"发布为模板"入口

**Files:**
- `frontend/src/pages/Home.tsx`（修改）

**Steps:**
1. 项目卡片新增"发布为模板"按钮（仅对非模板项目显示）
2. 点击弹出 Modal：
   - 输入分类（官方/社区，默认社区）
   - 输入标签（逗号分隔）
   - 确认调 `templateApi.publish(projectId, { category, tags })`
3. 发布成功后 toast 提示

**验收：**
- Home 页项目卡片有"发布为模板"按钮
- 点击弹出 Modal，填写后发布成功
- tsc --noEmit 无错误

---

#### Task 7: 端到端验证

**Files:**
- 验证用，仅修改代码如发现 bug

**Steps:**
1. 启动后端 + 前端
2. 验证设置页：
   - 修改用户名/邮箱/头像 URL，保存后刷新数据持久化
   - 重复用户名/邮箱返回错误提示
3. 验证模板市场：
   - GET /templates/ 返回 3 个官方模板
   - 搜索/分类筛选正常
   - 克隆模板创建新项目，编辑器中显示复制的 nodes/edges
   - 发布项目为模板，模板列表中出现
   - 取消发布，模板列表中消失
4. `cd frontend && pnpm tsc --noEmit` 无错误
5. 最终 commit（如有验证中修复）

**验收：**
- 全部验证项通过
- tsc clean

---

## Self-Review

**1. Spec coverage：**

| 需求 | 对应 Task |
|------|-----------|
| 设置页个人信息持久化 | Task 1（PUT /me）+ Task 2（前端对接） |
| 模板列表展示（含搜索/筛选） | Task 4（GET /templates/）+ Task 5（前端） |
| 模板克隆为新项目 | Task 4（clone）+ Task 5（导入按钮） |
| 项目发布为模板 | Task 4（publish）+ Task 6（Home 入口） |
| 预置官方模板 | Task 3（seed 数据） |
| 项目删除级联清理 | 已有逻辑（projects.py delete_project） |

**2. 依赖关系：**
- Task 1 → Task 2（前端依赖后端端点）
- Task 3 → Task 4（API 依赖模型字段）
- Task 4 → Task 5/6（前端依赖后端 API）
- Task 5/6 → Task 7（验证依赖前端完成）

**3. 风险点：**
- clone 时节点 ID 冲突：用 `{新项目UUID前8位}_{原节点ID}` 作为新节点 ID
- seed 数据的 owner_id：迁移时查询是否存在 system 用户，不存在则创建
- 模板项目的 workflow 删除：复用现有 delete_project 级联逻辑

---

## Execution Handoff

计划已完成。采用 Subagent-Driven 方式执行：每个任务派遣 implementer subagent，任务间审查。
