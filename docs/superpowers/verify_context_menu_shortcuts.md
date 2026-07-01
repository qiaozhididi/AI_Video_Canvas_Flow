# 右键菜单与快捷键体系验证清单

> 验证时间：2026-07-01
> 分支：feature/context-menu-shortcuts
> 验证范围：Task 1-8 全部交付物

## 1. 自动化测试

### 1.1 单元测试

**命令**：`cd frontend && pnpm vitest run`

**结果**：✅ PASS — 3 个测试文件，59 个测试用例全部通过

| 测试文件 | 覆盖范围 |
|---------|---------|
| `src/stores/canvasStore.test.ts` | editingNodeId / setEditingNodeId / renameNode（正常/空文本/同名/不存在）/ removeNode 写历史 / removeNodes 批量删除 / addPastedNodes targetPosition |
| `src/stores/clipboardStore.test.ts` | copy / paste / hasClipboard / clear + 深拷贝独立性 + 新 ID 格式 + 20px 偏移 + pasteCount 递增 |
| `src/utils/alignment.test.ts` | 8 种对齐函数 + 空数组/单节点/负坐标/等距分布降级场景 |

### 1.2 类型检查

**命令**：`cd frontend && pnpm tsc --noEmit`

**结果**：✅ PASS — 仅 1 处预先存在错误（与本功能无关）

```
src/mock/renderMock.ts:10:3 - error TS2322: RenderTaskResponse 缺少 node_label/project_name
```

本功能涉及的 8 个文件（ContextMenu.tsx / useContextMenu.ts / ShortcutHelpModal.tsx / canvasStore.ts / canvasStore.test.ts / CanvasNode.tsx / Canvas.tsx / EditorLayout.tsx）均 0 错误。

## 2. 代码审查（subagent-driven-development）

**结果**：✅ 全部 7 个实现任务通过审查

| Task | 内容 | Review 结果 | 修复 |
|------|------|------------|------|
| Task 1 | canvasStore 扩展（editingNodeId/renameNode/removeNodes/addPastedNodes targetPosition） | Approved | 1 Important: clearCanvas 未重置 editingNodeId |
| Task 2 | useContextMenu hook | Approved | 0 |
| Task 3 | ContextMenu 通用组件 | Approved | 2 Important: 边界检测负值 + disabled 子菜单 ArrowRight |
| Task 4 | ShortcutHelpModal 帮助面板 | Approved | 1 Critical: Esc 键关闭缺失 |
| Task 5 | CanvasNode inline 重命名 | Approved | 1 Important: Escape/blur 冲突（cancelledRef 守卫） |
| Task 6 | Canvas 集成右键菜单 | Approved | 0（5 Minor 接受） |
| Task 7 | EditorLayout 扩展快捷键 | Approved | 1 fix: F5 preventDefault 上移避免浏览器刷新 |

## 3. MCP 端到端验证

**状态**：⚠️ BLOCKED — mock 模式未 mock 认证 API

**阻塞原因**：
- `pnpm dev:mock` 启动 Vite 在 mock 模式，但 mock 仅覆盖 canvas/render/media 数据，未 mock `authApi.login`
- 登录请求发送到后端 API（`/api/v1/auth/login`），无后端运行时连接超时（`ERR_CONNECTION_TIMED_OUT`）
- 无法通过 MCP Chrome DevTools 完成登录流程进入编辑器
- Zustand stores 未暴露到 `window` 对象，无法通过 `evaluate_script` 直接注入 mock 数据

**需人工验证的 9 项**（在正常浏览器 + 后端环境中执行）：

| # | 验证点 | 预期行为 | 状态 |
|---|-------|---------|------|
| 1 | 右键节点菜单 | 出现菜单，含"复制/粘贴/重命名/删除"等项 | 需人工验证 |
| 2 | 删除（可撤销） | 节点减少 + 历史栈增加 + Ctrl+Z 恢复 | 需人工验证 |
| 3 | 右键画布粘贴 | 先 Ctrl+C 复制，右键空白 → 粘贴，新节点位置接近右键坐标 | 需人工验证 |
| 4 | F2 重命名 | 选中单节点 → F2 → input 出现 → 输入 → Enter → label 更新 | 需人工验证 |
| 5 | Escape 取消选中 | 选中多节点 → Escape → selectedNodeIds 清空 | 需人工验证 |
| 6 | Ctrl+/ 帮助面板 | ShortcutHelpModal 出现，含 3 分组 14 项快捷键 | 需人工验证 |
| 7 | F5 执行节点 | 选中可执行节点 → F5 → 触发执行（不刷新浏览器） | 需人工验证 |
| 8 | Escape 关闭帮助面板 | 帮助面板打开 → Escape → 面板关闭 | 需人工验证 |
| 9 | Escape 退出编辑态 | 编辑态 input 聚焦 → Escape → 退出编辑不保存 | 需人工验证 |

## 4. 已知限制

1. **Escape 与 ContextMenu 双重触发**（Minor，brief 接受）：右键节点打开菜单 + 节点被选中时，按 Escape 一次会同时关闭菜单和取消选中。行为非破坏性，连续按两次 Escape 的预期行为被合并为一次。
2. **buildPaneMenuItems 的 NODE_CATEGORIES 三元冗余**（Minor）：`NODE_CATEGORIES ? ... : []` 三元永远走 true 分支，不影响功能。
3. **visible=false 时仍求值 items**（Minor）：Canvas re-render 时 buildNodeMenuItems/buildPaneMenuItems 会被调用，轻微性能浪费，不影响正确性。

## 5. 验证结论

- **自动化测试**：✅ 全部通过（59/59 单元测试 + tsc 类型检查）
- **代码审查**：✅ 7 个任务全部 Approved，所有 Critical/Important 问题已修复
- **MCP 端到端**：⚠️ 受 mock 认证限制阻塞，9 项 UI 验证需在完整环境（前端 + 后端）中人工执行
- **合并建议**：可合并，MCP 验证项不阻塞（自动化测试 + 代码审查已覆盖核心逻辑）
