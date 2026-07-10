# AI 配置账号绑定设计

## 目标
将 AI Provider/Model 配置绑定到用户 ID，实现多用户独立管理各自的 AI 配置。

## 现状
- `ai_providers` 和 `ai_models` 表无 `user_id` 字段
- API 路由接收 `CurrentUser` 但查询时未按 user_id 过滤
- 所有用户共享同一套 AI 配置
- 现有数据：1 个 Provider（火山引擎）+ 3 个 Model，属于无主数据

## 设计方案

### 数据库变更
1. `ai_providers` 新增 `user_id` 列（UUID 外键 → users.id，ON DELETE CASCADE）
2. `ai_models` 不加 `user_id`，通过 `provider_id → ai_providers.user_id` 间接关联
3. 数据迁移：将现有 Provider/Model 绑定到 qzfrato（ID: ea148b9e-ecde-4fbc-9335-95edc4b7dec0）

### API 变更
- 所有 Provider CRUD 路由：创建时自动填充 user_id，查询/更新/删除时过滤 user_id
- 所有 Model CRUD 路由：查询时通过 JOIN provider 过滤 user_id
- `/models/default` 端点：加 user_id 过滤

### 服务层变更
- `_get_provider_and_model`：新增 user_id 参数
- `_get_default_model_for_type`、`_get_default_llm_model_id`：新增 user_id 过滤
- `ensure_default_ai_config`：新增 user_id 参数
- Celery 任务调用链：从 render_task → project → owner_id 获取 user_id

### 前端变更
- 无需变更，前端 API 调用已携带 JWT Token，后端自动提取 user_id

## 修改文件清单
1. `backend/app/models/ai_provider.py` — 新增 user_id 字段
2. `backend/app/api/ai.py` — 所有路由加 user_id 过滤
3. `backend/app/services/ai_service.py` — 查询函数加 user_id 参数
4. `backend/alembic/versions/xxx_add_user_id_to_ai_providers.py` — 迁移脚本
5. Celery 任务调用 ai_service 的地方需要传入 user_id
