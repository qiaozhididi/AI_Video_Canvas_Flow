# 实施计划：WebSocket 实时协作

> 创建时间: 2026-06-27
> 分支: feature/websocket-collaboration
> 基线: main (a47d27b)

## 目标

1. **后端 JWT 鉴权**：Socket.IO connect 时验证 JWT token（query string 传 token），拒绝非法连接
2. **后端房间成员清单**：服务端维护内存房间清单，join_project 时返回在线用户快照
3. **前端 collabStore**：封装 Socket.IO 客户端（连接/join/leave/emit/订阅），管理在线用户和远端光标状态
4. **节点/边实时同步**：本地变更广播给其他用户，远端变更应用到本地 canvasStore
5. **远端光标渲染**：Canvas 叠加光标层，跟随画布缩放/平移
6. **在线用户列表 UI**：EditorLayout 工具栏显示在线用户

## 全局约束

- 后端所有数据持久化到 PostgreSQL（协作变更不直接写 DB，依赖现有 autoSaveStore 双防抖保存）
- 前端 API 客户端使用相对路径 + Vite 代理（/socket.io 已配置 ws:true）
- Git commit message 必须用中文简短描述
- 协作变更不写 DB（避免与 autoSaveStore 双写冲突），实时同步靠 WebSocket，持久化靠自动保存
- 避免循环依赖：collabStore 不 import canvasStore，canvasStore import collabStore

## 现状（调研结论）

### 后端（`backend/app/ws/collaboration.py`）
- Socket.IO 已挂载在 main.py（`ASGIApp(sio, other_asgi_app=app)`，共端口，走 /socket.io/）
- 8 个事件处理器：connect/disconnect/join_project/leave_project/node_update/edge_update/cursor_move/ping
- ❌ connect 无 JWT 鉴权（仅记日志）
- ❌ join_project 的 user_id 由客户端传入，不校验身份
- ❌ 无房间成员清单（无法返回在线用户快照）
- ❌ node_update/edge_update 仅广播不写 DB（阶段四保持，依赖自动保存）
- 死代码：`setup_collaboration(app)` 未被调用（实际用 ASGIApp 挂载）

### 前端
- `socket.io-client ^4.8.3` 已安装但零使用代码
- 无 collabStore.ts
- 无协作 UI（在线用户/远端光标）
- vite proxy /socket.io 已配置（ws:true）
- CORS 已就绪

## 任务分解

### Task 1: 后端 — connect JWT 鉴权 + 房间成员清单 + 清理死代码

**Files:**
- `backend/app/ws/collaboration.py`（修改）

**Steps:**
1. 删除死代码 `setup_collaboration(app)` 函数（第 21-25 行）
2. 新增 import：`from urllib.parse import parse_qs`、`from jose import jwt, JWTError`、`from app.config import settings`
3. 新增全局房间成员清单：`_room_members: dict[str, list[dict]] = {}`（key=room_id, value=[{sid, user_id, username}, ...]）
4. `connect` 事件改为：
   - 从 `environ.get('QUERY_STRING', '')` 解析 token（`parse_qs(qs).get('token', [None])[0]`）
   - 无 token 或验证失败 → 返回 False（拒绝连接）
   - 验证成功 → `await sio.save_session(sid, {'user_id': user_id, 'username': username})`
   - username 暂用 user_id（因 JWT 只含 sub=user_id，不含 username；或查询 DB 获取 username）
   - 日志含 user_id
5. `join_project` 事件改为：
   - 从 session 取 user_id（不再信任 client 传入的 user_id）
   - 加入房间 + 添加到 _room_members 清单
   - 返回当前房间在线用户快照（作为 ack 数据）：`{"users": _room_members[room]}`
   - 广播 user_joined（含 user_id + sid[:8]）
6. `leave_project` 和 `disconnect` 事件：
   - 从 _room_members 移除该 sid
   - 广播 user_left
7. `node_update`/`edge_update`/`cursor_move`：保持仅广播，但日志中补充 user_id（从 session 取）

**验收：**
- 无 token 连接被拒绝（connect 返回 False）
- 无效 token 连接被拒绝
- 有效 token 连接成功，session 含 user_id
- join_project 返回当前在线用户列表
- 第二个用户 join 后，第一个用户收到 user_joined 事件
- disconnect 后从 _room_members 移除
- 死代码 setup_collaboration 已删除

---

### Task 2: 前端 — collabStore.ts 新建

**Files:**
- `frontend/src/stores/collabStore.ts`（新建）

**Steps:**
1. 新建 Zustand store，state 包含：
   - `socket: Socket | null`（socket.io-client 实例）
   - `isConnected: boolean`
   - `onlineUsers: OnlineUser[]`（`{sid, user_id, username}`）
   - `remoteCursors: RemoteCursor[]`（`{sid, user_id, username, x, y}`）
2. actions：
   - `connect(projectId)`：用 `io('/socket.io/', { query: { token: localStorage.getItem('access_token') }, transports: ['websocket'] })` 连接；绑定 connect/disconnect 事件更新 isConnected
   - `disconnect()`：socket.disconnect() + 清空 state
   - `joinProject()`：emit 'join_project'，ack 回调设置 onlineUsers
   - `leaveProject()`：emit 'leave_project'
   - `emitNodeUpdate(data)` / `emitEdgeUpdate(data)`：广播本地变更
   - `emitCursorMove(x, y)`：广播光标位置（节流 50ms）
   - `onNodeUpdate(callback)` / `onEdgeUpdate(callback)`：订阅远端变更（返回 unsubscribe 函数）
   - `onUserJoined(callback)` / `onUserLeft(callback)`：订阅用户加入/离开
3. 内部监听：
   - 'user_joined' → 添加到 onlineUsers
   - 'user_left' → 从 onlineUsers 移除 + 从 remoteCursors 移除
   - 'cursor_move' → 更新 remoteCursors（按 sid 去重）
4. connect 成功后自动 joinProject()

**验收：**
- collabStore 存在且导出 connect/disconnect/joinProject/emitNodeUpdate 等
- 连接时带 token query string
- joinProject 后 onlineUsers 填充
- emitNodeUpdate 调用 socket.emit
- tsc --noEmit 无错误

---

### Task 3: 前端 — canvasStore 接入 collabStore（实时同步）

**Files:**
- `frontend/src/stores/canvasStore.ts`（修改）

**Steps:**
1. import collabStore
2. 在 setNodes/setEdges（或 addNode/updateNode/deleteNode 等变更方法）中，变更后调用 `collabStore.getState().emitNodeUpdate({project_id, node_id, action, node})`
3. 新增 `applyRemoteNodeUpdate(data)` / `applyRemoteEdgeUpdate(data)` 方法：
   - 根据 action（add/update/delete）更新本地 nodes/edges
   - 不触发 emit（避免回环）
4. 在 EditorLayout 或 Canvas 初始化时，调用 `collabStore.onNodeUpdate(canvasStore.applyRemoteNodeUpdate)` 和 `collabStore.onEdgeUpdate(canvasStore.applyRemoteEdgeUpdate)` 订阅远端变更

**验收：**
- 本地新增节点后，collabStore.emitNodeUpdate 被调用
- 远端 node_update 事件触发 applyRemoteNodeUpdate，本地画布更新
- 无回环（远端变更不再 emit）
- tsc --noEmit 无错误

---

### Task 4: 前端 — EditorLayout 接入 collabStore + 在线用户列表 UI

**Files:**
- `frontend/src/components/EditorLayout.tsx`（修改）

**Steps:**
1. import collabStore
2. `useEffect`：进入编辑器时 `collabStore.connect(projectId)`，离开时 `collabStore.disconnect()`
3. 工具栏新增在线用户列表区域：
   - 显示 onlineUsers 头像（用 user_id 前 2 字符作为头像文字，或用 avatar_url 如果有）
   - 鼠标悬停显示 username/sid
   - 当前用户标记
4. 样式：圆形头像叠加，最多显示 5 个，超出显示 +N

**验收：**
- 进入编辑器后 Socket.IO 连接建立，在线用户列表显示
- 多个用户加入时列表更新
- 离开编辑器断开连接
- tsc --noEmit 无错误

---

### Task 5: 前端 — 远端光标渲染组件

**Files:**
- `frontend/src/components/RemoteCursors.tsx`（新建）
- `frontend/src/components/Canvas.tsx`（修改，引入 RemoteCursors）

**Steps:**
1. 新建 RemoteCursors 组件：
   - 从 collabStore 读取 remoteCursors
   - 用 React Flow 的 `useReactFlow().getViewport()` 获取当前 viewport（x, y, zoom）
   - 渲染一个 div 层，应用 transform：`translate(${x}px, ${y}px) scale(${zoom})`
   - 内部每个光标用绝对定位（left=cursor.x, top=cursor.y），显示箭头图标 + username 标签
2. Canvas 组件中引入 RemoteCursors，放在 ReactFlow 内部（作为子组件，能访问 useReactFlow）
3. 鼠标移动事件：在 Canvas 的 onMouseMove 中，用 `screenToFlowPosition()` 转换坐标，调 `collabStore.emitCursorMove(flowX, flowY)`（节流 50ms）

**验收：**
- 多个用户协作时，能看到彼此的光标
- 光标跟随画布缩放/平移
- 光标含 username 标签
- tsc --noEmit 无错误

---

### Task 6: 端到端验证

**Files:**
- 验证用，仅修改代码如发现 bug

**Steps:**
1. 启动后端 + 前端
2. 后端验证（Python 脚本）：
   - 无 token 连接被拒绝
   - 有效 token 连接成功
   - join_project 返回在线用户列表
   - node_update 广播给同房间其他成员
3. 前端验证（手动浏览器，2 个标签页模拟 2 用户）：
   - 两个用户进入同一项目，在线列表显示 2 人
   - 用户 A 拖动节点，用户 B 看到节点移动
   - 用户 A 添加节点，用户 B 看到新节点
   - 用户 A 鼠标移动，用户 B 看到光标
   - 用户 B 离开，用户 A 在线列表更新
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
| 后端 Socket.IO 连接验证 JWT | Task 1（connect 鉴权） |
| 后端房间成员清单 | Task 1（_room_members + join 返回快照） |
| 前端 WebSocket 客户端 | Task 2（collabStore） |
| 前端节点/边实时同步 | Task 3（canvasStore 接入） |
| 前端远端光标渲染 | Task 5（RemoteCursors 组件） |
| 在线用户列表 UI | Task 4（EditorLayout 工具栏） |
| node_update/edge_update 写入数据库 | 不做（依赖 autoSaveStore，避免双写冲突） |

**2. 依赖关系：**
- Task 1 → Task 2（前端依赖后端鉴权和房间清单）
- Task 2 → Task 3（canvasStore 依赖 collabStore）
- Task 2 → Task 4（EditorLayout 依赖 collabStore）
- Task 2 + Task 3 → Task 5（光标依赖 collabStore，Canvas 已接入同步）
- Task 1-5 → Task 6（验证依赖全部完成）

**3. 风险点：**
- JWT 鉴权：connect 时 token 在 query string，需确保日志不记录 token
- 房间成员清单：内存存储，服务重启丢失（可接受，协作是实时的）
- 回环风险：远端变更不能再 emit，canvasStore.applyRemoteNodeUpdate 不调 emitNodeUpdate
- 光标性能：高频 mousemove 需节流（50ms）
- username 获取：JWT 只含 user_id，connect 时需查 DB 获取 username（或前端 join 时传 username，但后端不信任）

---

## Execution Handoff

计划已完成。采用 Subagent-Driven 方式执行：每个任务派遣 implementer subagent，任务间审查。
