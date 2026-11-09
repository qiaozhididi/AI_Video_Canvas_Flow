# Cursor Bugbot 代码审查规则

本仓库是 AI Canvas Flow：AI 视频生成画布应用，包含三个子项目：

- `frontend/` — React 18 + Vite + TypeScript + Tailwind + Zustand + @xyflow/react（画布）
- `backend/` — Python 3.12 + FastAPI + SQLAlchemy(asyncpg) + Celery + MinIO
- `backend_nest/` — NestJS 10 + TypeORM + BullMQ + Socket.IO（重构中的新后端）

审查时优先关注以下问题，按严重程度排序。

## 1. 正确性（最高优先级）

- 异步代码：`async/await` 遗漏、未捕获的 Promise rejection、竞态条件（尤其是协作锁、渲染任务状态流转）
- 状态管理：Zustand store 的不必要全局订阅导致的过度重渲染；React  hooks 依赖数组缺失或错误
- WebSocket（Socket.IO）：事件监听未在组件卸载时解绑、重连后状态未恢复
- 数据库事务：多步写入未包裹在事务中，失败时产生部分写入
- 队列任务（Celery / BullMQ）：任务幂等性——同一任务重复执行不能产生副作用

## 2. 安全

- JWT 鉴权：新增 API 路由必须确认鉴权依赖（`get_current_user` / JwtAuthGuard）未被绕过
- 文件上传：校验文件类型与大小；对象存储 key 必须服务端生成，禁止直接使用用户传入的路径（防路径穿越）
- FFmpeg / 子进程调用：任何拼接用户输入进 shell 命令的代码都是严重问题，必须使用参数数组形式
- 密钥与配置：禁止硬编码密钥、API Key；默认值只能是占位符（如 `change-me-...`）
- SQL：禁止字符串拼接 SQL，必须使用 ORM / 参数化查询

## 3. 性能

- React：大列表缺 `key` 或使用 index 作为 key；渲染中创建新对象/函数导致 memo 失效
- 画布节点：@xyflow/react 节点更新必须使用 immutable 方式
- 后端：N+1 查询；循环内 await 可并行化的独立请求；大文件读入内存而非流式处理

## 4. 可维护性（KISS）

- 反对过度工程化：一次性逻辑不应抽象成通用工具；无明确复用需求不引入新依赖
- 新增代码应跟随所在子项目现有风格，不要引入另一种范式
- 删除代码应彻底，不留注释掉的死代码、不留"兼容性"包袱
- 注释只解释"为什么"，不复述代码做了什么

## 5. 测试

- 修复 bug 的 PR 应附带能复现该 bug 的测试
- 测试不应依赖外部服务（真实数据库、Redis、网络），应使用 mock / 内存实现

## 审查风格

- 用中文给出审查意见
- 只报告确定的问题，标注文件与行号；不确定的以提问形式提出
- 对风格类的小问题降级为 suggestion，不阻塞合并
