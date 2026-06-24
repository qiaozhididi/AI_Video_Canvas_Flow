/**
 * AI Canvas Flow — 前后端对接 API 调用示例
 *
 * 包含：认证、项目 CRUD、媒体上传、渲染任务查询、协作 WebSocket
 * 基于 fetch + Socket.IO Client
 */

const API_BASE = '/api/v1';
const WS_BASE = '';  // Socket.IO 通过 Vite 代理，路径为 /socket.io/

// ═══════════════════════════════════════════════════
// 1. 认证模块
// ═══════════════════════════════════════════════════

/** 注册 */
async function register(username: string, email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) throw new Error(`注册失败: ${res.status}`);
  return res.json(); // { id, username, email }
}

/** 登录，返回 access_token + refresh_token */
async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`登录失败: ${res.status}`);
  const data = await res.json(); // { access_token, refresh_token, token_type }
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  return data;
}

/** 获取认证 Headers */
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
  };
}

// ═══════════════════════════════════════════════════
// 2. 项目 CRUD
// ═══════════════════════════════════════════════════

/** 获取项目列表 */
async function listProjects() {
  const res = await fetch(`${API_BASE}/projects/`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`获取项目列表失败: ${res.status}`);
  return res.json(); // ProjectResponse[]
}

/** 创建项目 */
async function createProject(name: string, description?: string) {
  const res = await fetch(`${API_BASE}/projects/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`创建项目失败: ${res.status}`);
  return res.json(); // ProjectResponse
}

/** 获取项目详情 */
async function getProject(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取项目详情失败: ${res.status}`);
  return res.json();
}

/** 删除项目 */
async function deleteProject(projectId: string) {
  const res = await fetch(`${API_BASE}/projects/${projectId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`删除项目失败: ${res.status}`);
}

// ═══════════════════════════════════════════════════
// 3. 媒体资产 — 上传与下载
// ═══════════════════════════════════════════════════

/**
 * 上传媒体文件到 MinIO
 *
 * 流程：
 * 1. 前端选择文件 → POST /api/v1/media/upload (multipart/form-data)
 * 2. 后端将文件存入 MinIO，返回 MediaAssetResponse（含 asset_id）
 * 3. 后续播放/下载通过 GET /api/v1/media/{asset_id}/presign 获取预签名 URL
 */
async function uploadMedia(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/media/upload`, {
    method: 'POST',
    headers: {
      // 注意：上传文件不要设置 Content-Type，浏览器会自动加 boundary
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: formData,
  });
  if (!res.ok) throw new Error(`上传失败: ${res.status}`);
  return res.json(); // MediaAssetResponse
}

/**
 * 批量上传多个媒体文件
 */
async function uploadMediaBatch(files: File[]) {
  const results = await Promise.all(files.map((file) => uploadMedia(file)));
  return results; // MediaAssetResponse[]
}

/**
 * 获取媒体资产列表
 */
async function listMedia() {
  const res = await fetch(`${API_BASE}/media/`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`获取媒体列表失败: ${res.status}`);
  return res.json(); // MediaAssetResponse[]
}

/**
 * 获取预签名下载 URL
 *
 * 用途：视频播放、图片预览、文件下载
 * 预签名 URL 有时效性（通常 1 小时），过期需重新获取
 */
async function getPresignedUrl(assetId: string) {
  const res = await fetch(`${API_BASE}/media/${assetId}/presign`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`获取预签名 URL 失败: ${res.status}`);
  const data = await res.json(); // { url: string }
  return data.url;
}

/**
 * 在 video.js 中播放媒体资产
 */
async function playMediaAsset(videoElement: HTMLVideoElement, assetId: string) {
  const url = await getPresignedUrl(assetId);
  videoElement.src = url;
  videoElement.load();
  return url;
}

/**
 * 删除媒体资产
 */
async function deleteMedia(assetId: string) {
  const res = await fetch(`${API_BASE}/media/${assetId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`删除媒体失败: ${res.status}`);
}

// ═══════════════════════════════════════════════════
// 4. 渲染任务 — 创建与查询
// ═══════════════════════════════════════════════════

/**
 * 创建渲染任务
 *
 * 流程：
 * 1. 前端提交渲染请求 → POST /api/v1/render/
 * 2. 后端创建 Celery 任务，返回 task_id
 * 3. 前端轮询 GET /api/v1/render/{task_id} 查询进度
 * 4. 任务完成后通过 presigned URL 下载成品
 */
async function createRenderTask(projectId: string, outputFormat: string = 'mp4') {
  const res = await fetch(`${API_BASE}/render/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ project_id: projectId, output_format: outputFormat }),
  });
  if (!res.ok) throw new Error(`创建渲染任务失败: ${res.status}`);
  return res.json(); // RenderTaskResponse
}

/**
 * 查询渲染任务状态（轮询）
 *
 * 返回字段：task_id, status(pending/running/completed/failed), progress(0-100), output_url
 */
async function getRenderTask(taskId: string) {
  const res = await fetch(`${API_BASE}/render/${taskId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`查询渲染任务失败: ${res.status}`);
  return res.json(); // RenderTaskResponse
}

/**
 * 轮询渲染任务直到完成
 *
 * @param taskId 渲染任务 ID
 * @param intervalMs 轮询间隔（默认 2000ms）
 * @param onProgress 进度回调
 */
async function pollRenderTask(
  taskId: string,
  intervalMs: number = 2000,
  onProgress?: (progress: number, status: string) => void
) {
  return new Promise<{ status: string; output_url?: string }>((resolve, reject) => {
    const poll = async () => {
      try {
        const task = await getRenderTask(taskId);
        onProgress?.(task.progress || 0, task.status);

        if (task.status === 'completed') {
          resolve(task);
        } else if (task.status === 'failed') {
          reject(new Error(`渲染任务失败: ${task.error || '未知错误'}`));
        } else {
          setTimeout(poll, intervalMs);
        }
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
}

/**
 * 取消渲染任务
 */
async function cancelRenderTask(taskId: string) {
  const res = await fetch(`${API_BASE}/render/${taskId}/cancel`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`取消渲染任务失败: ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════
// 5. 协作 WebSocket (Socket.IO)
// ═══════════════════════════════════════════════════

import { io, Socket } from 'socket.io-client';

/**
 * 创建协作 WebSocket 连接
 *
 * 事件列表：
 * - join_project: 加入项目房间
 * - leave_project: 离开项目房间
 * - node_update: 节点更新广播
 * - edge_update: 边更新广播
 * - cursor_move: 远端光标移动
 * - user_joined / user_left: 协作者加入/离开通知
 * - ping / pong: 延迟检测
 */
function createCollabSocket(projectId: string, userId: string): Socket {
  const socket = io(WS_BASE, {
    transports: ['websocket'],
    query: { project_id: projectId, user_id: userId },
  });

  // 连接成功
  socket.on('connect', () => {
    console.log(`[Collab] 已连接, sid=${socket.id}`);
    socket.emit('join_project', { project_id: projectId, user_id: userId });
  });

  // 断开连接
  socket.on('disconnect', (reason) => {
    console.log(`[Collab] 已断开: ${reason}`);
  });

  // 其他协作者加入
  socket.on('user_joined', (data) => {
    console.log(`[Collab] 用户加入: ${data.user_id}`);
  });

  // 其他协作者离开
  socket.on('user_left', (data) => {
    console.log(`[Collab] 用户离开: ${data.user_id}`);
  });

  // 接收节点更新
  socket.on('node_update', (data) => {
    console.log(`[Collab] 节点更新: node=${data.node_id} action=${data.action}`);
    // 在此处调用 canvasStore 更新节点
  });

  // 接收边更新
  socket.on('edge_update', (data) => {
    console.log(`[Collab] 边更新: edge=${data.edge_id} action=${data.action}`);
  });

  // 接收远端光标
  socket.on('cursor_move', (data) => {
    // 渲染远端光标: { sid, x, y, user_id }
  });

  return socket;
}

/**
 * 发送节点更新到协作房间
 */
function emitNodeUpdate(
  socket: Socket,
  projectId: string,
  nodeId: string,
  action: string,
  payload: Record<string, unknown>
) {
  socket.emit('node_update', {
    project_id: projectId,
    node_id: nodeId,
    action,
    ...payload,
  });
}

/**
 * 发送边更新到协作房间
 */
function emitEdgeUpdate(
  socket: Socket,
  projectId: string,
  edgeId: string,
  action: string,
  payload: Record<string, unknown>
) {
  socket.emit('edge_update', {
    project_id: projectId,
    edge_id: edgeId,
    action,
    ...payload,
  });
}

/**
 * 发送光标位置
 */
function emitCursorMove(
  socket: Socket,
  projectId: string,
  x: number,
  y: number
) {
  socket.emit('cursor_move', {
    project_id: projectId,
    x,
    y,
  });
}

/**
 * 延迟检测：发送 ping，测量往返时间
 */
function measureLatency(socket: Socket): Promise<number> {
  return new Promise((resolve) => {
    const clientTime = Date.now();
    socket.emit('ping', { client_time: clientTime });

    const handler = (data: { client_time: number; server_time: number }) => {
      const rtt = Date.now() - data.client_time;
      socket.off('pong', handler);
      resolve(rtt);
    };

    socket.on('pong', handler);
  });
}

// ═══════════════════════════════════════════════════
// 6. 完整使用示例
// ═══════════════════════════════════════════════════

async function exampleWorkflow() {
  // 1. 注册 & 登录
  await register('demo', 'demo@example.com', 'password123');
  const { access_token } = await login('demo', 'password123');
  console.log('登录成功, token:', access_token.slice(0, 20) + '...');

  // 2. 创建项目
  const project = await createProject('我的 AI 视频', '使用 AI 生成视频');
  console.log('项目创建成功:', project.id);

  // 3. 上传媒体文件
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*,audio/*';
  // 实际使用中从用户输入获取文件
  // const file = fileInput.files?.[0];
  // if (file) {
  //   const asset = await uploadMedia(file);
  //   console.log('上传成功:', asset.id);
  //
  //   // 获取预签名 URL 用于播放
  //   const url = await getPresignedUrl(asset.id);
  //   console.log('播放 URL:', url);
  // }

  // 4. 创建渲染任务
  const task = await createRenderTask(project.id, 'mp4');
  console.log('渲染任务已创建:', task.id || task.task_id);

  // 5. 轮询渲染进度
  // const result = await pollRenderTask(task.id, 2000, (progress, status) => {
  //   console.log(`渲染进度: ${progress}% (${status})`);
  // });
  // console.log('渲染完成:', result.output_url);

  // 6. 建立协作连接
  const socket = createCollabSocket(project.id, 'demo');
  // emitNodeUpdate(socket, project.id, 'node-1', 'update', { params: { steps: 30 } });
  // emitCursorMove(socket, project.id, 100, 200);

  // 7. 测量延迟
  // const latency = await measureLatency(socket);
  // console.log(`WebSocket 延迟: ${latency}ms`);
}

export {
  register,
  login,
  getAuthHeaders,
  listProjects,
  createProject,
  getProject,
  deleteProject,
  uploadMedia,
  uploadMediaBatch,
  listMedia,
  getPresignedUrl,
  playMediaAsset,
  deleteMedia,
  createRenderTask,
  getRenderTask,
  pollRenderTask,
  cancelRenderTask,
  createCollabSocket,
  emitNodeUpdate,
  emitEdgeUpdate,
  emitCursorMove,
  measureLatency,
  exampleWorkflow,
};
