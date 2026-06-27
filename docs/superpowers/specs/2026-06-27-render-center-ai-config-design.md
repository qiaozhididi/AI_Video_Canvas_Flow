# 渲染中心前后端打通 + AI 可配置系统设计

> 日期: 2026-06-27

## 目标

1. 渲染中心前端替换 Mock 数据，对接后端 renderApi
2. 后端渲染任务触发 Celery，实时写回 DB（progress/status/result_url）
3. AI Provider/Model 可配置系统（类 NewAPI），支持多平台、多模型、多 Key
4. Celery 任务接入火山引擎豆包 LLM，实现 AI 生成工作流

## 数据库新增表

### ai_providers

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | UUID | PK | |
| name | VARCHAR(128) | NOT NULL | 显示名称 |
| platform | VARCHAR(64) | NOT NULL | volcengine/openai/custom |
| base_url | VARCHAR(512) | NOT NULL | API 端点 |
| api_key | VARCHAR(512) | NOT NULL | API Key |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

### ai_models

| 列 | 类型 | 约束 | 说明 |
|----|------|------|------|
| id | UUID | PK | |
| provider_id | UUID | FK ai_providers.id | |
| model_id | VARCHAR(128) | NOT NULL | 平台模型标识 |
| display_name | VARCHAR(128) | NOT NULL | 前端显示名 |
| model_type | VARCHAR(32) | NOT NULL | llm/image_gen/video_gen/tts |
| is_active | BOOLEAN | DEFAULT true | |
| created_at | TIMESTAMP | | |
| updated_at | TIMESTAMP | | |

## 后端 API

### 新增端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `GET /api/v1/render/` | GET | 获取当前用户渲染任务列表 |
| `POST /api/v1/ai/providers` | POST | 创建 AI Provider |
| `GET /api/v1/ai/providers` | GET | 列出所有 Provider |
| `PUT /api/v1/ai/providers/{id}` | PUT | 更新 Provider |
| `DELETE /api/v1/ai/providers/{id}` | DELETE | 删除 Provider |
| `POST /api/v1/ai/models` | POST | 创建 AI Model |
| `GET /api/v1/ai/models` | GET | 列出所有 Model（可选 provider_id 筛选） |
| `PUT /api/v1/ai/models/{id}` | PUT | 更新 Model |
| `DELETE /api/v1/ai/models/{id}` | DELETE | 删除 Model |

### 修改端点

| 端点 | 变更 |
|------|------|
| `POST /api/v1/render/` | 创建后触发 `run_render_task.delay(task_id)` |
| `POST /api/v1/render/{id}/cancel` | 撤销 Celery 任务（revoke） |

## Celery 任务改造

### run_render_task(task_id)

1. 从 DB 读取 RenderTask + 关联 Project
2. 根据 task_type 选择执行路径：
   - `render`：读取工作流节点，按拓扑排序执行
   - `text2img`/`img2video`/`tts`：调用 ai_service 执行 AI 推理
3. 实时更新 DB：progress、status、result_url、error_message
4. 完成后 result_url 指向 MinIO 中的输出文件

### ai_service.py

- `call_llm(provider, model_id, messages)` — 调用 LLM（豆包/OpenAI 兼容）
- `call_image_gen(provider, model_id, prompt, params)` — 文生图（预留）
- `call_video_gen(provider, model_id, image_url, params)` — 图生视频（预留）
- `call_tts(provider, model_id, text, params)` — TTS（预留）
- 所有方法从 ai_providers/ai_models 表读取配置，动态构建请求

## 前端变更

### RenderCenter.tsx

- 替换 MOCK_TASKS 为 `renderApi.list()`
- 提交任务：选择项目 + 模型 → `renderApi.create()`
- 进度轮询：对 running/pending 任务自动 `renderApi.poll()`
- 取消任务：`renderApi.cancel()`
- 下载结果：从 MinIO presign URL 下载
- 统计卡片从真实数据计算

### apiClient.ts

- 新增 `renderApi.list()`
- 新增 `aiApi.providers.create/list/update/delete`
- 新增 `aiApi.models.create/list/update/delete`

### Settings.tsx

- 新增"AI 配置"标签页
- Provider 管理：添加/编辑/删除 API 平台配置
- Model 管理：添加/编辑/删除模型配置

## 环境变量

```env
# 火山引擎默认配置（首次启动自动创建 Provider）
DEFAULT_AI_PROVIDER_NAME=火山引擎
DEFAULT_AI_PLATFORM=volcengine
DEFAULT_AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DEFAULT_AI_API_KEY=ark-2f3e7fdb-c282-4454-9290-edea990c168b-72bbb
DEFAULT_AI_MODEL_ID=doubao-seed-2-1-turbo-260628
DEFAULT_AI_MODEL_DISPLAY_NAME=豆包 Seed 2.1 Turbo
DEFAULT_AI_MODEL_TYPE=llm
```

## 涉及文件

**后端新增：**
- `backend/app/models/ai_provider.py`
- `backend/app/models/ai_model.py`
- `backend/app/api/ai.py`
- `backend/app/services/ai_service.py`

**后端修改：**
- `backend/app/api/render.py` — 新增 list 端点 + 触发 Celery + cancel revoke
- `backend/app/tasks/render_tasks.py` — 接入 ai_service + 实时写 DB
- `backend/app/database.py` — 注册新表
- `backend/app/config.py` — 新增默认 AI 环境变量
- `backend/.env` — 新增默认 AI 配置

**前端修改：**
- `frontend/src/pages/RenderCenter.tsx` — 替换 Mock
- `frontend/src/utils/apiClient.ts` — 新增 renderApi.list + aiApi
- `frontend/src/pages/Settings.tsx` — 新增 AI 配置面板

**前端新增：**
- `frontend/src/mock/renderMock.ts` — 渲染 Mock 数据
