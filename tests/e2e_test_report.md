# AI Canvas Flow — MCP 端到端真实场景测试报告

> 测试时间: 2026-06-25 18:57 | 测试工具: MCP Chrome DevTools (evaluate_script) + PostgreSQL 直连验证 + 基础设施测试

## 一、测试环境

| 组件 | 地址 | 状态 |
|------|------|------|
| 后端 FastAPI | `http://localhost:8000` | 运行中 |
| PostgreSQL | `192.168.10.76:5432/ai_canvas_flow` | 已连接 |
| Redis | `192.168.10.76:6379/0` | 已连接 (v8.8.0) |
| MinIO | `192.168.10.76:9000` | 已连接 |
| RabbitMQ | `192.168.10.76:5672` | 已连接 (v4.3.2) |

## 二、基础设施测试 (27/27 PASS)

### Redis (8/8)

| 测试项 | 结果 | 详情 |
|--------|------|------|
| 连接 (db=0) | PASS | ping=True |
| SET/GET | PASS | 读写正常 |
| HSET/HGETALL | PASS | 3 个字段 |
| RPUSH/LRANGE | PASS | 3 个元素 |
| EXPIRE/TTL | PASS | ttl=120s |
| Celery 后端 (db=1) | PASS | ping=True |
| 服务器信息 | PASS | version=8.8.0 |
| 内存使用 | PASS | 1.00M |

### MinIO (9/9)

| 测试项 | 结果 | 详情 |
|--------|------|------|
| 连接 | PASS | 192.168.10.76:9000 |
| 桶 ai-canvas-flow | PASS | 桶已存在 |
| 上传文件 | PASS | 40 bytes |
| 获取文件信息 | PASS | size/content_type 正确 |
| 下载文件 | PASS | 内容校验 match=True |
| 预签名 URL | PASS | 1h 有效期 |
| 列出文件 | PASS | 正常 |
| 删除文件 | PASS | 清理完成 |
| 桶列表 | PASS | 7 个桶 |

### RabbitMQ (10/10)

| 测试项 | 结果 | 详情 |
|--------|------|------|
| AMQP 连接 | PASS | qzfrato@192.168.10.76:5672 |
| 声明队列 | PASS | durable=True |
| 发布消息 | PASS | 发送成功 |
| 消费消息 | PASS | 内容匹配 |
| 删除队列 | PASS | 清理完成 |
| 声明 Exchange | PASS | type=direct |
| 删除 Exchange | PASS | 清理完成 |
| Management API | PASS | version=4.3.2 |
| 队列列表 | PASS | 正常 |
| Exchange 列表 | PASS | 正常 |

## 三、MCP 真实场景 E2E 测试 (20/20 PASS)

使用 MCP Chrome DevTools `evaluate_script` 在浏览器中执行真实 HTTP 请求，模拟完整用户操作流程。

### 测试用户

| 字段 | 值 |
|------|------|
| username | `fulltest_1782385031619` |
| email | `fulltest_1782385031619@test.com` |
| user_id | `53dbdfe3-18e7-432b-be2e-fe261848be06` |
| password | `Test1234!` |

### 完整测试流程

| # | 步骤 | API | 方法 | HTTP状态 | 返回数据 | 结果 |
|---|------|-----|------|----------|----------|------|
| 1 | 注册新用户 | `/api/v1/auth/register` | POST | **200** | `id=53dbdfe3-..., username=fulltest_1782385031619` | PASS |
| 2 | 用户登录 | `/api/v1/auth/login` | POST | **200** | `hasToken=true` | PASS |
| 3 | 获取当前用户 | `/api/v1/auth/me` | GET | **200** | `username=fulltest_1782385031619` | PASS |
| 4 | 错误密码登录 | `/api/v1/auth/login` | POST | **401** | 认证拒绝 | PASS |
| 5 | 创建项目 | `/api/v1/projects/` | POST | **200** | `id=f85d9ca9-..., name=完整测试项目_...` | PASS |
| 6 | 项目列表 | `/api/v1/projects/` | GET | **200** | `count=1` | PASS |
| 7 | 项目详情 | `/api/v1/projects/{id}` | GET | **200** | `name=完整测试项目_...` | PASS |
| 8 | 更新项目 | `/api/v1/projects/{id}` | PUT | **200** | `name=更新后项目_..., desc=更新后的描述` | PASS |
| 9 | 上传媒体 | `/api/v1/media/upload` | POST | **200** | `id=7b5fa7b3-..., fileName=fulltest_....png, fileSize=22` | PASS |
| 10 | 媒体列表 | `/api/v1/media/` | GET | **200** | `count=1` | PASS |
| 11 | 媒体详情 | `/api/v1/media/{id}` | GET | **200** | `fileName=fulltest_....png` | PASS |
| 12 | 预签名URL | `/api/v1/media/{id}/presign` | GET | **200** | `hasUrl=true, expiresIn=3600` | PASS |
| 13 | 创建渲染任务 | `/api/v1/render/` | POST | **200** | `id=542a37b1-..., status=pending` | PASS |
| 14 | 查询渲染任务 | `/api/v1/render/{id}` | GET | **200** | `status=pending` | PASS |
| 15 | 取消渲染任务 | `/api/v1/render/{id}/cancel` | POST | **200** | `status=cancelled` | PASS |
| 16 | 协作状态 | `/api/v1/collab/status` | GET | **200** | `{status: "ok", transport: "socket.io"}` | PASS |
| 17 | 删除媒体 | `/api/v1/media/{id}` | DELETE | **204** | (无内容) | PASS |
| 18 | 删除项目 | `/api/v1/projects/{id}` | DELETE | **204** | (级联删除关联渲染任务) | PASS |
| 19 | 验证项目已删除 | `/api/v1/projects/{id}` | GET | **404** | 项目不存在 | PASS |
| 20 | 验证媒体已删除 | `/api/v1/media/{id}` | GET | **404** | 媒体不存在 | PASS |

## 四、PostgreSQL 数据库验证

### 基线 vs 测试后对比

| 表名 | 基线 | 测试后 | 变化 | 说明 |
|------|------|--------|------|------|
| `users` | 5 | **6** | +1 | 新用户 `fulltest_1782385031619` 写入 |
| `projects` | 4 | 4 | 0 | 创建的项目已删除（步骤18） |
| `media_assets` | 2 | 2 | 0 | 上传的媒体已删除（步骤17） |
| `render_tasks` | 3 | 3 | 0 | 渲染任务随项目级联删除 |
| `workflow_nodes` | 0 | 0 | - | 暂无测试 |
| `workflow_edges` | 0 | 0 | - | 暂无测试 |

### 数据写入验证详情

**新增用户** (写入确认):

| id | username | email |
|----|----------|-------|
| `53dbdfe3-18e7-432b-be2e-fe261848be06` | fulltest_1782385031619 | fulltest_1782385031619@test.com |

**删除验证** (项目+媒体+渲染任务均正确删除):
- 项目 `f85d9ca9-c25d-49a3-b397-56ca5a72f81c` — 步骤18 DELETE → 步骤19 GET 404 确认
- 媒体 `7b5fa7b3-7ef5-4544-a189-77a4e93245f6` — 步骤17 DELETE → 步骤20 GET 404 确认
- 渲染任务 `542a37b1-aec2-41fa-92cd-e32f3da12945` — 随项目级联删除

### 现存数据

**用户 (6条)**:

| id | username | email |
|----|----------|-------|
| `191d5a79-6eab-4c7d-a29a-96d9a34701f5` | mcp_user_1782306241017 | mcp_1782306241017@test.com |
| `34e27bc1-3411-4bf2-9049-81e739868a2e` | dbtest_1782305395975 | dbtest_1782305395975@test.com |
| `3aeddbb1-cafc-4bb7-9c8c-3837274c6742` | e2e_user_1782306836185 | e2e_user_1782306836185@test.com |
| `43e21753-3b8e-43f0-b743-82c010bb4dc9` | mcp_real_1782306636694 | mcp_real_1782306636694@test.com |
| `53dbdfe3-18e7-432b-be2e-fe261848be06` | fulltest_1782385031619 | fulltest_1782385031619@test.com |
| `bcf336f6-2cae-4e01-9616-d17c4859efdb` | dbtest2_1782305474431 | dbtest2_1782305474431@test.com |

**项目 (4条)**:

| id | name | owner_id |
|----|------|----------|
| `913578e2-2991-4575-bfbf-74ab7ce3e392` | 数据库测试项目 | `34e27bc1-...` |
| `6f898ad1-dc67-4732-89e1-0f7285688d73` | DB测试项目 | `bcf336f6-...` |
| `ed87d220-6dfe-44b4-a611-15abf4c4bf60` | MCP数据库测试项目 | `191d5a79-...` |
| `bac2f2e2-6211-4b35-ba7e-3a6bd54eb8fa` | MCP真实测试项目_1782306636694 | `43e21753-...` |

**媒体资产 (2条)**:

| id | file_name | owner_id | file_size |
|----|-----------|----------|-----------|
| `0dc3459e-f3d0-40b8-a416-d5e21a680b36` | db_test.png | `bcf336f6-...` | 69 |
| `beb82f52-fe9b-4a7d-bb96-0a41e7b38b46` | mcp_test.png | `191d5a79-...` | 69 |

**渲染任务 (3条)**:

| id | project_id | owner_id | status | task_type |
|----|------------|----------|--------|-----------|
| `7ca5bc86-c32b-41b1-a916-bc2fcdf8bc82` | `6f898ad1-...` | `bcf336f6-...` | cancelled | render |
| `cf9bdde4-06b3-4da5-a451-229436351c81` | `ed87d220-...` | `191d5a79-...` | cancelled | render |
| `60551367-f0fb-4eb5-96d6-80a0bd2cbca5` | `bac2f2e2-...` | `43e21753-...` | cancelled | render |

### 外键关系验证

| 关系 | 有效引用数 | 结果 |
|------|-----------|------|
| `projects.owner_id` → `users.id` | 4 | PASS |
| `render_tasks.project_id` → `projects.id` | 3 | PASS |
| `render_tasks.owner_id` → `users.id` | 3 | PASS |
| `media_assets.owner_id` → `users.id` | 2 | PASS |

## 五、测试总结

| 测试类别 | 通过/总数 | 说明 |
|----------|-----------|------|
| Redis 基础设施 | **8/8** | 连接/读写/哈希/列表/过期/多DB |
| MinIO 基础设施 | **9/9** | 连接/桶/上传/下载/预签名/删除 |
| RabbitMQ 基础设施 | **10/10** | AMQP连接/队列/发布/消费/Exchange/Management API |
| MCP API E2E 测试 | **20/20** | 注册→登录→项目CRUD→媒体→渲染→协作→删除 |
| PostgreSQL 数据验证 | **4/4 表** | users/projects/media_assets/render_tasks |
| 外键关系验证 | **4/4 关系** | 所有外键正确关联 |
| **总计** | **55/55** | 全部通过 |

## 六、运行验证命令

```bash
# 1. 启动后端
cd backend && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 2. 验证数据库数据
cd backend && source venv/bin/activate && python3 check_db.py

# 3. 基础设施测试
cd backend && source venv/bin/activate && python3 test_infra.py
```
