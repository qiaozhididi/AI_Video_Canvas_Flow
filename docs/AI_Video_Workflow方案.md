## 一、 系统架构全景补全

核心难点在于“前端交互重”**（无限画布+时间轴）与**“后端计算重”（AI 模型推理+视频渲染）。完整的架构需要补充以下四个核心模块：

### 1. 前端：画布与时间轴双向联动 (Canvas & Timeline Synergy)

* **补充：** 单靠 React Flow 画布无法精细控制视频的“时间帧”。必须引入一个**全局时间轴（Timeline）**。
* **逻辑：** 画布负责逻辑结构（如：角色 A 节点 $\rightarrow$ 动作 B 节点 $\rightarrow$ 背景 C 节点 $\rightarrow$ 视频生成节点）；时间轴负责线性合并（如：视频1在 0-5 秒，视频2在 5-10 秒，音频在 0-10 秒垫底）。两者共享一个状态管理中心（如 Zustand 或 Redux）。

### 2. 存储与传输：分块与流式处理 (Chunked Storage & Streaming)

* **补充：** AIGC 视频动辄几百 MB 甚至数 GB，单纯靠 API 上传下载会挤爆服务器。
* **设计：** 引入 **MinIO / AWS S3 对象存储**。前端生成或处理视频时，通过预签名 URL（Presigned URL）直传云端；`video.js` 播放端采用 **HLS (HTTP Live Streaming)** 或 DASH 进行流式切片播放，拒绝直接加载原生 MP4 大文件。

### 3. 后端：AI 算力网关与状态机 (AI Agent & State Machine)

* **补充：** LangChain 负责单点 Prompt 或 Agent 编排，但无法管理复杂的“节点依赖状态”（比如：节点 3 必须等节点 1 的图片和节点 2 的音频都生成完才能触发）。
* **设计：** 引入 **LangGraph** 或 **Temporal** 作为工作流状态机。每个 React Flow 连线在后端对应一个 DAG（有向无环图）的任务节点。

### 4. 算力与渲染：混合式媒体处理 (Hybrid Media Processing)

* **补充：** 前端 `ffmpeg.wasm` 算力极度受限（单线程、内存上限 2GB/4GB），只能用于轻量级的浏览器端视频裁剪、预览或加水印。
* **设计：** 真正的重度视频合成（如多轨道混音、大视频特效、转码）必须由后端的 **Celery GPU/CPU Worker 运行原生 FFmpeg** 完成。

---

## 二、 核心功能模块设计 (LibTV 级别)

为了达到 LibTV 的工业级多模态创作体验，我们需要实现以下五大核心功能：

```
[文本/图片输入] ──> [画布节点编排 (React Flow)] ──> [AI 算力生成 (LangChain/FastAPI)]
                                                              │
[最终视频输出] <── [后端大师级渲染 (FFmpeg/Celery)] <── [时间轴精确对齐 (Video.js)]

```

### 1. 节点矩阵 (Nodes Matrix)

工作流编辑器需要提供 5 种核心节点：

* **输入节点：** 文本（剧本/Prompt）、图片（角色参考/场景图）、音频（人声/BGM）。
* **AI 推理节点：** 文生图（SD/Midjourney API）、图生视频（Sora/Runway/Kling API）、文生语音（TTS 节点，如 CosyVoice）。
* **处理节点：** 视频扩图、高清放大（Upscale）、风格化滤镜、抠图（SAM 节点）。
* **控制节点：** 逻辑分支（If-Else）、循环、合并（Merge）。
* **输出节点：** 视频单片段、最终长片预览。

### 2. 实时预览与时间轴同步 (Timeline & Preview)

* 多轨道设计：视频轨、音频轨、特效轨、字幕轨。
* React Flow 中的每一个“视频/音频输出节点”，都可以一键拖拽投递到下方的“时间轴”中。
* `video.js` 绑定自定义插件，实现逐帧预览、快进、多轨道音频混音预览。

### 3. 混合 FFmpeg 渲染策略 (Hybrid FFmpeg Strategy)

* **前端（ffmpeg.wasm）：** 用户在画布上调整视频裁剪区域、倍速、加本地实时字幕时，直接在浏览器端计算并实时预览，**零服务器带宽消耗**。
* **后端（Native FFmpeg）：** 当用户点击“合成最终完整长片”时，前端将工作流 DAG 数据和时间轴 JSON 提交给 FastAPI。FastAPI 组装成复杂的 FFmpeg 命令行，丢给 Celery 异步队列，在后端完成后存入 S3。

---

## 三、 全栈技术架构图 (Tech Stack Architecture)

| 层级 | 选用技术 | 职责与核心实现 |
| --- | --- | --- |
| **前端画布** | React + React Flow + Zustand | 节点拖拽、连线、DAG 图形数据序列化、自定义节点（带输入框和预览窗口）。 |
| **前端媒体** | video.js + ffmpeg.wasm | 视频播放控制、时间轴逐帧对齐、浏览器端轻量级切片/裁剪预览。 |
| **后端网关** | FastAPI + Pydantic | 提供高性能异步 API，负责接收画布 JSON、鉴权、状态查询、管理 WebSocket 双向流（用于实时进度推送）。 |
| **AI 编排** | LangChain + LangGraph | 将 React Flow 的拓扑结构转化为 Python 可执行的 DAG 状态机，调用各类大模型（LLM/SD/Video Model）API。 |
| **异步任务** | Celery + Redis + RabbitMQ | 异步队列管理。RabbitMQ 负责高可靠任务分发；Redis 负责存储节点执行的中间状态（State Sync）。 |
| **重度渲染** | Python-FFmpeg + GPU Worker | 部署在带 GPU 的工作节点上，执行后端超高清视频合成、多通道混音、编码压缩（H.264/H.265）。 |
| **数据存储** | PostgreSQL + MinIO (S3) | Postgres 存储工作流元数据、用户信息；MinIO 存储临时和最终的音视频、图片资产。 |

---

## 四、 关键数据流向 (Data Flow Canvas)

以一个典型的 **“文生图 $\rightarrow$ 图生视频 $\rightarrow$ 加 BGM 合成”** 工作流为例，数据在系统中的流转如下：

```
[前端 React Flow] ──(1. 导出拓扑 JSON)──> [FastAPI 网关]
                                               │
                                       (2. 转换为 LangGraph 任务)
                                               │
                                               ▼
[Celery 队列] <──(3. 分发原子任务)── [LangChain / 状态机]
      │
      ├──> 任务 A (AI 绘图): 调用 SD API -> 结果存入 MinIO -> 更新状态(25%)
      ├──> 任务 B (图生视频): 读取 MinIO 图片 -> 调用 Kling API -> 视频存入 MinIO -> 更新状态(60%)
      └──> 任务 C (媒体合成): 下载视频+BGM -> 后端 FFmpeg 混流合并 -> 最终 MP4 -> 更新状态(100%)
                                               │
                                       (4. WebSocket 广播进度)
                                               │
                                               ▼
[前端 Video.js] <──(5. HLS 流式播放)── [用户端屏幕]

```

---

## 五、 项目落地实施的潜在痛点与解决方案

1. **长时间连接挂起问题：** AI 视频生成通常需要几分钟甚至十几分钟。
* *解决：* 前端绝对不能依靠 HTTP 短轮询。必须在 FastAPI 中建立 **WebSocket** 连接，或者使用 **SSE (Server-Sent Events)**。Celery Worker 每完成一个节点或者模型返回进度时，通过 Redis Pub/Sub 通知 FastAPI，再由 WebSocket 实时推送到前端 React Flow 节点上显示进度条（例如：“正在生成视频：45%”）。


2. **前端 ffmpeg.wasm 性能瓶颈：** 浏览器多线程支持（SharedArrayBuffer）需要特定的 HTTP Header 跨域隔离配置。
* *解决：* 后端（FastAPI/Nginx）必须配置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`。同时严格限制前端处理的分辨率（如不超过 720P），仅做“草稿级”预览。


3. **大资产并发读写：** 多个节点同时读写同一个视频文件。
* *解决：* 引入**分布式文件锁**或利用 Celery 的链式任务（Chains/Chords）。在 LangGraph 中严格定义数据的依赖输入（Input Artifacts）和输出（Output Artifacts），确保上游节点未写入完毕前，下游节点处于 `PENDING` 阻塞状态。



这个方案补充了工业级 AIGC 编辑器所需的**时间轴协同、大媒体流式存储、状态机调度以及前后端混合渲染机制**，能够完美支撑起类似 LibTV 的端到端创作体验。您看在具体的某个模块（比如 React Flow 自定义节点的设计，或是 FastAPI 与 Celery 的数据通信）上，我们需要先深入推演哪一部分？