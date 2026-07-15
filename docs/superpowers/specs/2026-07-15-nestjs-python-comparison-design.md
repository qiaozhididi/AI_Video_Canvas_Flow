# NestJS vs Python 后端全面对比检查设计

## 日期: 2026-07-15
## 分支: refactor/nestjs-backend

## 目标

对比 NestJS 重构后端与原 Python FastAPI 后端，验证功能完全一致性，重点检查数据库字段匹配、API 接口、env 环境配置等。

## 方法：并行子代理全量对比

按 6 个维度并行派发子代理，每个子代理独立对比并输出结构化差异报告。

### 子代理分工

| 子代理 | Python 源 | NestJS 源 | 检查重点 |
|--------|-----------|-----------|----------|
| 1. 数据库字段 | `app/models/` 10 个 SQLAlchemy 模型 | `src/modules/*/entities/` TypeORM 实体 | 表名、列名、类型、约束、外键级联 |
| 2. API 路由 | `app/api/` 12 个路由文件 | `src/modules/*.controller.ts` | 路径、HTTP 方法、请求/响应格式、状态码、认证 |
| 3. env 配置 | `.env.example` + `app/config.py` | `.env.example` + `configuration.ts` | 环境变量名、默认值、遗漏项 |
| 4. 服务层逻辑 | `app/services/` + `app/api/*.py` | `src/modules/*.service.ts` | 业务逻辑、错误处理、权限校验、事务 |
| 5. 异步任务 | `app/tasks/` Celery | `src/queue/` BullMQ | 任务类型、处理逻辑、进度、取消 |
| 6. WebSocket | `app/ws/collaboration.py` | `src/ws/collaboration.gateway.ts` | 事件名、鉴权、ack、广播、节点锁 |

### 输出格式

每个子代理输出结构化差异报告，按严重度分类：
- **Critical**: 功能缺失/不兼容，必须修复
- **Important**: 行为差异，建议修复
- **Minor**: 风格差异，可接受

### 执行流程

1. 并行派发 6 个子代理（只读对比，不修改文件）
2. 汇总 6 份差异报告
3. 合并去重 + 按严重度排序
4. 输出统一对比报告
5. 若发现 Critical → 转入 writing-plans 创建修复计划
6. 若全部一致 → 直接完成

### 约束

- 子代理只做只读对比，不修改任何文件
- 每个子代理有明确的 Python/NestJS 文件映射
- 最终报告标注每条差异的可修复性
