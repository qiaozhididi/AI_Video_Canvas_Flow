# 核心创作闭环验证清单

**验证时间**：2026-06-29
**验证分支**：feature/core-creation-loop
**前端服务**：`pnpm dev --port 5174`
**后端服务**：`uvicorn --reload --port 8000`（需运行以支持工作流执行）

## 前置条件
- 后端运行中，/health 返回 200
- 至少一个 AI Provider + Model 已配置（或用默认 SeedReam）
- 已登录用户，已创建/打开一个项目

## 验证点

### Task 1: timelineStore 播放循环
| # | 验证点 | 结果 |
|---|--------|------|
| 1 | 展开时间轴，点击播放按钮，播放头从 0 向 duration 推进 | ☐ |
| 2 | 播放到 duration 末尾自动停止，isPlaying=false | ☐ |
| 3 | 播放中点击暂停，播放头立即停止 | ☐ |
| 4 | 播放中点击时间轴不同位置（seekTo），播放头跳转后继续推进（无跳变） | ☐ |

### Task 2: VideoPreview 接入选中节点输出
| # | 验证点 | 结果 |
|---|--------|------|
| 5 | 无选中节点时，VideoPreview 显示「暂无视频预览」 | ☐ |
| 6 | 选中无 outputArtifacts 的节点，VideoPreview 仍显示占位 | ☐ |
| 7 | 执行工作流后选中 completed 节点，VideoPreview 显示输出（图片/视频） | ☐ |
| 8 | 切换选中节点，VideoPreview 跟随切换输出 | ☐ |
| 9 | 相对路径 URL 正确加 /api/v1/media/ 前缀（Network 面板验证 200） | ☐ |

### Task 3: 时间轴 ↔ 视频预览双向联动
| # | 验证点 | 结果 |
|---|--------|------|
| 10 | 点击时间轴不同位置，VideoPreview 播放头跳转到对应位置 | ☐ |
| 11 | 播放 VideoPreview，时间轴播放头跟随移动 | ☐ |
| 12 | 无视频源（仅图片）时，seekTo 仍生效（图片不触发 timeupdate） | ☐ |

### Task 4: 加入时间轴按钮
| # | 验证点 | 结果 |
|---|--------|------|
| 13 | 选中无 outputArtifacts 的节点，属性面板不显示「输出资产」区域 | ☐ |
| 14 | 选中有 outputArtifacts 的节点，显示每个 artifact + 「加入时间轴」按钮 | ☐ |
| 15 | 点击「加入时间轴」，对应类型轨道出现新片段 | ☐ |
| 16 | 片段起始位置 = 当前播放头位置 | ☐ |
| 17 | 片段时长：image 3s，video/audio 5s | ☐ |
| 18 | 点击时间轴新片段，VideoPreview 跳转到片段起始位置 | ☐ |

### 端到端主链路
| # | 验证点 | 结果 |
|---|--------|------|
| 19 | 完整流程：执行工作流 → 选中节点看预览 → 加入时间轴 → 播放时间轴 → VideoPreview 同步 | ☐ |

## 前端类型检查
- [ ] `cd frontend && pnpm tsc --noEmit` EXIT_CODE=0

## 结论
- 通过验证点数：__ / 19
- 前端 tsc：☐ PASS / ☐ FAIL
- 阻塞性问题：（列出，无则填「无」）
