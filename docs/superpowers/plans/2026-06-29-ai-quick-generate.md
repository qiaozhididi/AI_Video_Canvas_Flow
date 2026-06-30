# AI 快速生成 实施计划

> ✅ **状态：已完成（2026-06-30）** — 全部 6 个 Task 已执行完毕并合并到 main（merge commit 2693a9c，--no-ff）。下方 checkbox 未逐个同步更新，但所有步骤均已验证通过（tsc + pytest + 人工验证清单）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户输入自然语言描述 → 后端调 LLM → 自动生成工作流节点/边并加载到画布,实现"描述即可用,生成即可执行"。

**Architecture:** 前端模态框收集描述 → POST /ai/generate-workflow → 后端 `call_llm` + JSON 解析 + subtype 白名单校验 + 分层布局 + 参数预填 → 返回 NodeCreateRequest[]/EdgeCreateRequest[] → 前端 `canvasStore.loadGeneratedWorkflow(mode)` 加载 + `fitView` + 选中首节点。

**Tech Stack:** FastAPI + Pydantic + httpx (后端); React + TypeScript + Zustand + Tailwind (前端); 复用现有 `ai_service.call_llm`(OpenAI Chat Completions 兼容)。

## Global Constraints

- 复用现有 `ai_service.call_llm(db, model_id, messages, temperature=0.7) -> str`(不修改其签名)
- 复用现有 AI Provider/Model 配置(DB 表 `ai_providers`/`ai_models`)
- 节点白名单 16 种 subtype 必须与 `frontend/src/types/canvas.ts` 的 NODE_TEMPLATES 完全一致(后端维护一份相同常量)
- 不引入新依赖(dagre 等布局库)— 用自实现分层布局
- 后端 Pydantic schemas 内联到 `backend/app/api/ai.py`(遵循现有 ProviderCreate/ProviderUpdate 内联模式,不创建 `schemas/ai.py`)
- 前端转换函数 `toCanvasNode`/`toCanvasEdge` 从 `projectStore.ts` 提取到 `frontend/src/utils/canvasTransform.ts`(DRY,供 projectStore + canvasStore 共享)
- fitView 通过 canvasStore 的 `fitViewToken` 计数器触发(因 `reactFlowInstance` ref 在 Canvas.tsx 内部,EditorLayout 无法直接访问)
- Git commit message 用简短中文(如 `feat: 新增 AI 快速生成后端 service`)
- 不破坏现有自动保存/协作逻辑(生成后画布变更会触发 autoSaveStore 防抖保存)
- 模式 `replace` 清空画布后加载;`append` 追加时 edges 的 id 加前缀 `gen-` 避免与现有 edge id 冲突
- 所有回复/思考/任务清单用中文

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/app/services/ai_service.py` | 修改 | 新增 `generate_workflow(db, description, model_id)` + LLM prompt + JSON 解析 + 校验 + 布局 + 预填参数 |
| `backend/app/api/ai.py` | 修改 | 新增 `GenerateWorkflowRequest`/`GenerateWorkflowResponse` schema(内联) + POST `/ai/generate-workflow` endpoint |
| `backend/tests/test_ai_generate.py` | 新建 | `generate_workflow` 单元测试(mock call_llm) |
| `frontend/src/utils/canvasTransform.ts` | 新建 | 提取 `toCanvasNode`/`toCanvasEdge` 共享转换函数 |
| `frontend/src/stores/projectStore.ts` | 修改 | 删除内部 toCanvasNode/toCanvasEdge,改为从 canvasTransform 导入 |
| `frontend/src/utils/apiClient.ts` | 修改 | `aiApi` 新增 `generateWorkflow` 方法 |
| `frontend/src/stores/canvasStore.ts` | 修改 | 新增 `fitViewToken` + `requestFitView` + `loadGeneratedWorkflow` |
| `frontend/src/components/AiGenerateModal.tsx` | 新建 | AI 生成模态框组件 |
| `frontend/src/components/EditorLayout.tsx` | 修改 | 工具栏新增「AI 生成」按钮 + 模态框 state + onGenerated 回调 |
| `frontend/src/components/canvas/Canvas.tsx` | 修改 | useEffect 监听 fitViewToken 触发 fitView |
| `frontend/verify_ai_generate.md` | 新建 | 端到端验证清单 |

---

### Task 1: 后端 generate_workflow service + 单元测试

**Files:**
- Modify: `backend/app/services/ai_service.py`(在文件末尾追加)
- Create: `backend/tests/test_ai_generate.py`

**Interfaces:**
- Consumes: `call_llm(db, model_id, messages, temperature) -> str`(同文件已有);`AiModel`/`AiProvider` 模型;SQLAlchemy `db`
- Produces: `async def generate_workflow(db, description: str, model_id: str | None = None) -> dict` 返回 `{"nodes": [...], "edges": [...]}`,nodes/edges 元素为 `NodeCreateRequest` 兼容 dict(id/node_type/label/position_x/position_y/config)

- [ ] **Step 1: 写失败测试 — 合法 JSON 解析 + 布局 + 参数预填**

Create `backend/tests/test_ai_generate.py`:

```python
"""generate_workflow 单元测试

覆盖:
1. 合法 JSON → 正确解析 + 布局 + 参数预填
2. 非法 subtype → 跳过
3. 非 JSON → 抛 RuntimeError
4. 全部非法 → 抛 RuntimeError
"""

import pytest
from unittest.mock import patch, AsyncMock

from app.services.ai_service import generate_workflow


@pytest.mark.asyncio
async def test_generate_workflow_parses_valid_json():
    """LLM 返回合法 JSON 时,应正确解析、生成 ID、计算布局、预填参数"""
    fake_llm_response = '''{"nodes":[
        {"id":"n1","subtype":"text_input","label":"文本输入"},
        {"id":"n2","subtype":"text_to_image","label":"文生图"},
        {"id":"n3","subtype":"video_output","label":"视频输出"}
    ],"edges":[
        {"from":"n1","to":"n2"},
        {"from":"n2","to":"n3"}
    ]}'''

    with patch('app.services.ai_service.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = fake_llm_response
        # mock 默认模型查询:返回 None 让 generate_workflow 走 "无默认模型" 分支(model_id 留空)
        with patch('app.services.ai_service._get_default_model_for_type', new_callable=AsyncMock) as mock_default:
            mock_default.return_value = None
            result = await generate_workflow(db=None, description="生成产品宣传视频", model_id="fake-llm-uuid")

    # 验证节点
    assert len(result["nodes"]) == 3
    n1, n2, n3 = result["nodes"]
    # ID 格式: node-{timestamp}-{rand6}
    assert n1["id"].startswith("node-")
    # 节点类型映射
    assert n1["node_type"] == "input"
    assert n1["config"]["subtype"] == "text_input"
    assert n2["node_type"] == "ai_inference"
    assert n2["config"]["subtype"] == "text_to_image"
    assert n3["node_type"] == "output"
    # 布局: 第 0 层 x=0, 第 1 层 x=300, 第 2 层 x=600
    assert n1["position_x"] == 0
    assert n2["position_x"] == 300
    assert n3["position_x"] == 600
    # 同层 y=0(每个节点都在自己的层)
    assert n1["position_y"] == 0
    # 参数预填: text_input.params.text = description
    assert n1["config"]["params"]["text"] == "生成产品宣传视频"
    # 参数预填: ai_inference.params.prompt = description
    assert n2["config"]["params"]["prompt"] == "生成产品宣传视频"
    # model_id 留空(因 mock_default 返回 None)
    assert "model_id" not in n2["config"]["params"] or n2["config"]["params"].get("model_id") is None

    # 验证边: id 重新生成,source/target 指向新 node id
    assert len(result["edges"]) == 2
    e1, e2 = result["edges"]
    assert e1["source_node_id"] == n1["id"]
    assert e1["target_node_id"] == n2["id"]
    assert e2["source_node_id"] == n2["id"]
    assert e2["target_node_id"] == n3["id"]
    # 边 id 唯一
    assert e1["id"] != e2["id"]


@pytest.mark.asyncio
async def test_generate_workflow_skips_invalid_subtype():
    """LLM 返回含非法 subtype 时,跳过非法节点,保留合法部分"""
    fake_llm_response = '''{"nodes":[
        {"id":"n1","subtype":"text_input","label":"文本输入"},
        {"id":"n2","subtype":"invalid_subtype","label":"非法节点"},
        {"id":"n3","subtype":"video_output","label":"视频输出"}
    ],"edges":[
        {"from":"n1","to":"n2"},
        {"from":"n2","to":"n3"}
    ]}'''

    with patch('app.services.ai_service.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = fake_llm_response
        with patch('app.services.ai_service._get_default_model_for_type', new_callable=AsyncMock) as mock_default:
            mock_default.return_value = None
            result = await generate_workflow(db=None, description="测试", model_id="fake-uuid")

    # 只保留 n1 和 n3
    assert len(result["nodes"]) == 2
    assert result["nodes"][0]["config"]["subtype"] == "text_input"
    assert result["nodes"][1]["config"]["subtype"] == "video_output"
    # 边指向非法节点 n2 的应被过滤
    valid_ids = {n["id"] for n in result["nodes"]}
    valid_edges = [e for e in result["edges"] if e["source_node_id"] in valid_ids and e["target_node_id"] in valid_ids]
    assert len(valid_edges) == 0  # n1→n2 和 n2→n3 都引用了非法节点 n2


@pytest.mark.asyncio
async def test_generate_workflow_raises_on_non_json():
    """LLM 返回非 JSON 时,应抛 RuntimeError"""
    with patch('app.services.ai_service.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = "这不是 JSON,只是一段文字"
        with pytest.raises(RuntimeError, match="AI 返回格式异常"):
            await generate_workflow(db=None, description="测试", model_id="fake-uuid")


@pytest.mark.asyncio
async def test_generate_workflow_raises_when_all_invalid():
    """LLM 返回的全部节点 subtype 非法时,应抛 RuntimeError"""
    fake_llm_response = '''{"nodes":[
        {"id":"n1","subtype":"foo","label":"非法"},
        {"id":"n2","subtype":"bar","label":"非法"}
    ],"edges":[]}'''

    with patch('app.services.ai_service.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = fake_llm_response
        with pytest.raises(RuntimeError, match="AI 生成内容无效"):
            await generate_workflow(db=None, description="测试", model_id="fake-uuid")
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest tests/test_ai_generate.py -v`
Expected: FAIL with `ImportError: cannot import name 'generate_workflow' from 'app.services.ai_service'`

- [ ] **Step 3: 实现 generate_workflow 核心逻辑**

在 `backend/app/services/ai_service.py` 文件末尾追加(注意:文件已有 `import logging` / `import httpx` / `from uuid import UUID` / `from sqlalchemy import select` / `from app.models.ai_provider import AiProvider` / `from app.models.ai_model import AiModel`):

```python
import json
import time
import random
import string
from collections import defaultdict, deque


# ── AI 快速生成:节点白名单(与前端 NODE_TEMPLATES 保持一致) ──

NODE_WHITELIST: dict[str, str] = {
    # subtype → node_type
    "text_input": "input",
    "image_input": "input",
    "audio_input": "input",
    "text_to_image": "ai_inference",
    "image_to_video": "ai_inference",
    "text_to_speech": "ai_inference",
    "upscale": "processing",
    "style_transfer": "processing",
    "remove_bg": "processing",
    "extend_image": "processing",
    "if_else": "control",
    "loop": "control",
    "merge": "control",
    "video_output": "output",
    "image_output": "output",
    "audio_output": "output",
}

# 节点默认 label(中文名)
NODE_DEFAULT_LABELS: dict[str, str] = {
    "text_input": "文本输入",
    "image_input": "图片输入",
    "audio_input": "音频输入",
    "text_to_image": "文生图",
    "image_to_video": "图生视频",
    "text_to_speech": "文生语音",
    "upscale": "高清放大",
    "style_transfer": "风格化",
    "remove_bg": "抠图",
    "extend_image": "扩图",
    "if_else": "条件分支",
    "loop": "循环",
    "merge": "合并",
    "video_output": "视频输出",
    "image_output": "图片输出",
    "audio_output": "音频输出",
}

# 各 subtype 的默认 params(与前端 NODE_TEMPLATES 一致)
NODE_DEFAULT_PARAMS: dict[str, dict] = {
    "text_input": {"text": ""},
    "image_input": {"url": ""},
    "audio_input": {"url": ""},
    "text_to_image": {"prompt": "", "size": "1024x1024"},
    "image_to_video": {"prompt": "", "duration": 5},
    "text_to_speech": {"text": "", "voice": "default"},
    "upscale": {"scale": 2},
    "style_transfer": {"style": ""},
    "remove_bg": {},
    "extend_image": {"direction": "all"},
    "if_else": {"condition": ""},
    "loop": {"count": 1},
    "merge": {},
    "video_output": {"format": "mp4"},
    "image_output": {"format": "png"},
    "audio_output": {"format": "mp3"},
}

# AI 推理节点 model_type 映射(用于查找默认模型)
AI_INFERENCE_MODEL_TYPE: dict[str, str] = {
    "text_to_image": "image_gen",
    "image_to_video": "video_gen",
    "text_to_speech": "tts",
}


SYSTEM_PROMPT = """你是 AI 视频工作流编排助手。根据用户描述生成工作流节点和连接。

合法节点类型(仅可使用以下 subtype):
- 输入:text_input(文本输入), image_input(图片输入), audio_input(音频输入)
- AI 推理:text_to_image(文生图), image_to_video(图生视频), text_to_speech(文生语音)
- 处理:upscale(高清放大), style_transfer(风格化), remove_bg(抠图), extend_image(扩图)
- 控制:if_else(条件分支), loop(循环), merge(合并)
- 输出:video_output(视频输出), image_output(图片输出), audio_output(音频输出)

输出严格 JSON 格式(不要 markdown 代码块,不要额外文字):
{"nodes":[{"id":"n1","subtype":"text_input","label":"文本输入"}],"edges":[{"from":"n1","to":"n2"}]}

规则:
1. 节点 id 用简单标识(n1, n2, n3...)
2. 连接需符合数据流方向:输入 → AI推理/处理 → 输出
3. label 用中文
4. 不要填 params(由系统自动填充)
"""


async def _get_default_model_for_type(db, model_type: str) -> str | None:
    """查找指定 model_type 的首个 active 模型 UUID(字符串)

    用于 AI 推理节点的 model_id 预填。
    """
    if db is None:
        return None
    result = await db.execute(
        select(AiModel).where(
            AiModel.model_type == model_type,
            AiModel.is_active == True,  # noqa: E712
        ).order_by(AiModel.created_at.asc()).limit(1)
    )
    model = result.scalar_one_or_none()
    return str(model.id) if model else None


async def _get_default_llm_model_id(db, model_id: str | None) -> str:
    """获取 LLM 模型 UUID:优先用传入的 model_id,否则取默认 LLM 模型"""
    if model_id:
        return model_id

    if db is None:
        raise RuntimeError("未传入 model_id 且 db 不可用")

    result = await db.execute(
        select(AiModel).where(
            AiModel.model_type == "llm",
            AiModel.is_active == True,  # noqa: E712
        ).order_by(AiModel.created_at.asc()).limit(1)
    )
    model = result.scalar_one_or_none()
    if not model:
        raise RuntimeError("未找到可用的 LLM 模型,请先在设置页配置 model_type='llm' 的 active 模型")
    return str(model.id)


def _parse_llm_json(raw: str) -> dict:
    """解析 LLM 返回的 JSON,容忍 ```json 代码块包裹"""
    text = raw.strip()
    # 去除 markdown 代码块包裹
    if text.startswith("```"):
        # 去掉首行 ```json 或 ```
        lines = text.split("\n")
        if len(lines) >= 2:
            text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])
        text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"AI 返回格式异常,无法解析为 JSON: {e}")

    if not isinstance(data, dict):
        raise RuntimeError("AI 返回格式异常:顶层应为 JSON 对象")
    if "nodes" not in data or not isinstance(data["nodes"], list):
        raise RuntimeError("AI 返回格式异常:缺少 nodes 数组")
    if "edges" not in data or not isinstance(data["edges"], list):
        raise RuntimeError("AI 返回格式异常:缺少 edges 数组")

    return data


def _generate_node_id() -> str:
    """生成节点 ID:node-{timestamp_ms}-{rand6}"""
    ts = int(time.time() * 1000)
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"node-{ts}-{rand}"


def _generate_edge_id() -> str:
    """生成边 ID:edge-{timestamp_ms}-{rand6}"""
    ts = int(time.time() * 1000)
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"edge-{ts}-{rand}"


def _compute_layout(valid_nodes: list[dict]) -> None:
    """按拓扑分层计算 position,直接修改 valid_nodes 中每个元素的 position_x/position_y

    算法:
    1. 根据原始 id(LLM 给的 n1/n2)建邻接表
    2. Kahn 拓扑排序,计算每个节点的层
    3. 第 N 层 x=N*300;同层按索引 y=index*150
    """
    # 原始 id → 节点索引
    id_to_idx = {n["orig_id"]: i for i, n in enumerate(valid_nodes)}

    # 入度 + 邻接表(基于原始 id)
    in_degree = {n["orig_id"]: 0 for n in valid_nodes}
    adj: dict[str, list[str]] = defaultdict(list)
    # 注:edges 此时已绑定到 orig_id(在 _validate_and_map 中处理),但我们在 _validate_and_map 之前计算布局
    # 因此这里用 valid_nodes 之间的 edges(传入参数外的 edges 暂不在此处理)
    # 简化:在调用 _compute_layout 前,先过滤 edges,只保留两端都在 valid_nodes 中的

    # 注:edges 通过闭包传入(见 generate_workflow 实现)
    edges_for_layout = _compute_layout._edges  # type: ignore[attr-defined]
    for e in edges_for_layout:
        src = e["from"]
        tgt = e["to"]
        if src in in_degree and tgt in in_degree:
            adj[src].append(tgt)
            in_degree[tgt] += 1

    # Kahn 分层
    layer: dict[str, int] = {n["orig_id"]: 0 for n in valid_nodes}
    queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
    processed = 0
    while queue:
        nid = queue.popleft()
        processed += 1
        for child in adj[nid]:
            layer[child] = max(layer[child], layer[nid] + 1)
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    # 环检测:若 processed < 节点数,说明有环,用 fallback(按 orig_id 顺序排列)
    if processed < len(valid_nodes):
        logger.warning(f"[AI:Generate] 检测到环,使用 fallback 布局")
        for i, n in enumerate(valid_nodes):
            n["position_x"] = i * 300
            n["position_y"] = 0
        return

    # 按 layer 分组,同层按 orig_id 字典序排序
    by_layer: dict[int, list[dict]] = defaultdict(list)
    for n in valid_nodes:
        by_layer[layer[n["orig_id"]]].append(n)

    for layer_num, nodes_in_layer in by_layer.items():
        nodes_in_layer.sort(key=lambda x: x["orig_id"])
        for idx, n in enumerate(nodes_in_layer):
            n["position_x"] = layer_num * 300
            n["position_y"] = idx * 150


async def generate_workflow(db, description: str, model_id: str | None = None) -> dict:
    """AI 快速生成工作流

    Args:
        db: 数据库 session
        description: 自然语言工作流描述
        model_id: LLM 模型 UUID(可选,不传则取默认 LLM 模型)

    Returns:
        {"nodes": [NodeCreateRequest 兼容 dict], "edges": [EdgeCreateRequest 兼容 dict]}

    Raises:
        RuntimeError: 无可用 LLM 模型 / LLM 调用失败 / JSON 解析失败 / 全部节点非法
    """
    # 1. 获取 LLM 模型
    llm_model_id = await _get_default_llm_model_id(db, model_id)

    # 2. 调 LLM
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]
    logger.info(f"[AI:Generate] 调用 LLM 生成工作流, description={description[:50]}...")
    raw_response = await call_llm(db, llm_model_id, messages, temperature=0.3)

    # 3. 解析 JSON
    data = _parse_llm_json(raw_response)

    # 4. 校验 subtype 白名单 + 生成新 ID + 收集合法节点
    valid_nodes: list[dict] = []  # 每个元素: {orig_id, subtype, label, new_id}
    orig_to_new: dict[str, str] = {}
    skipped = 0
    for n in data["nodes"]:
        orig_id = n.get("id", "")
        subtype = n.get("subtype", "")
        if subtype not in NODE_WHITELIST:
            logger.warning(f"[AI:Generate] 跳过非法 subtype 节点: id={orig_id}, subtype={subtype}")
            skipped += 1
            continue
        if not orig_id:
            orig_id = f"n{len(valid_nodes) + 1}"
        new_id = _generate_node_id()
        valid_nodes.append({
            "orig_id": orig_id,
            "subtype": subtype,
            "label": n.get("label") or NODE_DEFAULT_LABELS.get(subtype, subtype),
            "new_id": new_id,
        })
        orig_to_new[orig_id] = new_id

    if not valid_nodes:
        raise RuntimeError("AI 生成内容无效:全部节点 subtype 非法")

    # 5. 过滤 edges(只保留两端都合法的)+ 重映射 id
    valid_edges: list[dict] = []
    for e in data["edges"]:
        src = e.get("from", "")
        tgt = e.get("to", "")
        if src in orig_to_new and tgt in orig_to_new:
            valid_edges.append({"from": src, "to": tgt})

    # 6. 计算布局(传入 valid_edges 供拓扑分层用)
    _compute_layout._edges = valid_edges  # type: ignore[attr-defined]
    _compute_layout(valid_nodes)

    # 7. 预填参数 + 组装最终 NodeCreateRequest
    result_nodes = []
    for n in valid_nodes:
        subtype = n["subtype"]
        node_type = NODE_WHITELIST[subtype]
        params = dict(NODE_DEFAULT_PARAMS.get(subtype, {}))

        # 预填: text_input.params.text = description
        if subtype == "text_input":
            params["text"] = description
        # 预填: AI 推理节点 params.prompt = description + model_id
        elif subtype in ("text_to_image", "image_to_video", "text_to_speech"):
            params["prompt"] = description
            model_type = AI_INFERENCE_MODEL_TYPE.get(subtype)
            if model_type:
                default_model = await _get_default_model_for_type(db, model_type)
                if default_model:
                    params["model_id"] = default_model

        result_nodes.append({
            "id": n["new_id"],
            "node_type": node_type,
            "label": n["label"],
            "position_x": n["position_x"],
            "position_y": n["position_y"],
            "config": {
                "type": node_type,
                "subtype": subtype,
                "label": n["label"],
                "params": params,
                "status": "idle",
                "progress": 0,
                "outputArtifacts": [],
            },
        })

    # 8. 组装最终 EdgeCreateRequest
    result_edges = []
    for e in valid_edges:
        result_edges.append({
            "id": _generate_edge_id(),
            "source_node_id": orig_to_new[e["from"]],
            "target_node_id": orig_to_new[e["to"]],
            "source_port": None,
            "target_port": None,
        })

    logger.info(f"[AI:Generate] 生成完成: {len(result_nodes)} 节点, {len(result_edges)} 边, 跳过 {skipped} 非法")

    return {"nodes": result_nodes, "edges": result_edges}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && python -m pytest tests/test_ai_generate.py -v`
Expected: 4 个测试全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_service.py backend/tests/test_ai_generate.py
git commit -m "feat: 新增 AI 快速生成后端 service"
```

---

### Task 2: 后端 POST /ai/generate-workflow endpoint

**Files:**
- Modify: `backend/app/api/ai.py`(在文件末尾追加)

**Interfaces:**
- Consumes: `generate_workflow(db, description, model_id) -> dict`(来自 Task 1)
- Produces: `POST /api/v1/ai/generate-workflow` 端点,接受 `GenerateWorkflowRequest`,返回 `GenerateWorkflowResponse`

- [ ] **Step 1: 在 ai.py 末尾追加 schema 定义**

在 `backend/app/api/ai.py` 文件末尾追加:

```python
# ── AI 快速生成 ──

class GenerateWorkflowRequest(BaseModel):
    description: str
    mode: str  # "replace" | "append"
    model_id: str | None = None


class GenerateWorkflowResponse(BaseModel):
    nodes: list[dict]
    edges: list[dict]
```

- [ ] **Step 2: 在 ai.py 末尾追加 endpoint**

继续追加:

```python
@router.post("/generate-workflow", summary="AI 快速生成工作流")
async def generate_workflow_endpoint(
    body: GenerateWorkflowRequest,
    db: DBSession,
    user: CurrentUser,
):
    """根据自然语言描述生成工作流节点和边

    - description: 工作流描述
    - mode: "replace"(替换画布) | "append"(追加到画布)
    - model_id: 可选 LLM 模型 UUID,不传则取默认 LLM 模型
    """
    from app.services.ai_service import generate_workflow as _generate_workflow

    if body.mode not in ("replace", "append"):
        raise HTTPException(status_code=422, detail="mode 必须为 'replace' 或 'append'")
    if not body.description.strip():
        raise HTTPException(status_code=422, detail="description 不能为空")

    try:
        result = await _generate_workflow(db, body.description, body.model_id)
    except RuntimeError as e:
        # 区分错误类型返回合适的状态码
        msg = str(e)
        if "未找到可用的 LLM 模型" in msg:
            raise HTTPException(status_code=404, detail=msg)
        elif "AI 返回格式异常" in msg or "AI 生成内容无效" in msg:
            raise HTTPException(status_code=502, detail=msg)
        else:
            raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {msg}")
    except Exception as e:
        logger.error(f"[AI:GenerateWorkflow] 未预期错误: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"AI 服务调用失败: {str(e)}")

    logger.info(f"[AI:GenerateWorkflow] user={user.id}, mode={body.mode}, nodes={len(result['nodes'])}")
    return result
```

- [ ] **Step 3: 验证导入和启动**

Run: `cd backend && python -c "from app.api.ai import router, GenerateWorkflowRequest, GenerateWorkflowResponse; print('OK')"`
Expected: 输出 `OK`,无 ImportError

- [ ] **Step 4: 启动后端验证端点注册**

Run: `cd backend && python -c "from app.main import app; routes = [r.path for r in app.routes]; print('/api/v1/ai/generate-workflow' in routes or any('generate-workflow' in str(r) for r in app.routes))"`
Expected: 输出 `True`

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/ai.py
git commit -m "feat: 新增 AI 快速生成 API endpoint"
```

---

### Task 3: 前端 canvasTransform + apiClient + canvasStore

**Files:**
- Create: `frontend/src/utils/canvasTransform.ts`
- Modify: `frontend/src/stores/projectStore.ts`(删除内部 toCanvasNode/toCanvasEdge,改为导入)
- Modify: `frontend/src/utils/apiClient.ts`(`aiApi` 新增 generateWorkflow)
- Modify: `frontend/src/stores/canvasStore.ts`(新增 fitViewToken + requestFitView + loadGeneratedWorkflow)

**Interfaces:**
- Consumes: `NodeCreateRequest`/`EdgeCreateRequest`/`WorkflowSaveRequest` 类型(来自 apiClient);`CanvasNode`/`CanvasEdge` 类型(来自 types/canvas)
- Produces:
  - `toCanvasNode(n: NodeCreateRequest): CanvasNode`(canvasTransform.ts)
  - `toCanvasEdge(e: EdgeCreateRequest): CanvasEdge`(canvasTransform.ts)
  - `aiApi.generateWorkflow(data): Promise<WorkflowSaveRequest>`(apiClient.ts)
  - `canvasStore.fitViewToken: number`
  - `canvasStore.requestFitView(): void`
  - `canvasStore.loadGeneratedWorkflow(nodes, edges, mode): void`

- [ ] **Step 1: 新建 canvasTransform.ts**

Create `frontend/src/utils/canvasTransform.ts`:

```typescript
/**
 * 画布数据格式转换工具
 *
 * 后端 NodeCreateRequest / EdgeCreateRequest ↔ 前端 CanvasNode / CanvasEdge
 * 供 projectStore.loadProjectToCanvas 和 canvasStore.loadGeneratedWorkflow 共享。
 */
import type { CanvasNode, CanvasEdge } from '@/types/canvas';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';

/** 后端 NodeCreateRequest → 前端 CanvasNode */
export function toCanvasNode(n: NodeCreateRequest): CanvasNode {
  const config = (n.config || {}) as Record<string, unknown>;
  return {
    id: n.id,
    type: n.node_type,
    position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
    data: {
      type: (config.type as CanvasNode['data']['type']) || 'input',
      subtype: (config.subtype as CanvasNode['data']['subtype']) || 'text_input',
      label: n.label || (config.label as string) || '未命名',
      params: (config.params as Record<string, unknown>) || {},
      status: (config.status as CanvasNode['data']['status']) || 'idle',
      progress: (config.progress as number) || 0,
      outputArtifacts: (config.outputArtifacts as CanvasNode['data']['outputArtifacts']) || [],
      error: config.error as string | undefined,
    },
  };
}

/** 后端 EdgeCreateRequest → 前端 CanvasEdge */
export function toCanvasEdge(e: EdgeCreateRequest): CanvasEdge {
  return {
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    sourceHandle: e.source_port || undefined,
    targetHandle: e.target_port || undefined,
  };
}
```

- [ ] **Step 2: 修改 projectStore.ts 导入共享转换函数**

Modify `frontend/src/stores/projectStore.ts`:

把第 79-121 行的 `toCanvasNode` 和 `toCanvasEdge` 两个函数定义删除,改为在文件顶部 import:

```typescript
// 第 7 行后追加导入
import { toCanvasNode, toCanvasEdge } from '@/utils/canvasTransform';
```

并删除 projectStore.ts 中第 79-121 行的 `function toCanvasNode(...)` 和 `function toCanvasEdge(...)` 两个函数定义。

注意:`toNodeCreate` 和 `toEdgeCreate`(前端的 CanvasNode → 后端 NodeCreateRequest 转换)保留在 projectStore.ts 不动(它们仅 projectStore 使用)。

- [ ] **Step 3: 在 apiClient.ts 的 aiApi 中新增 generateWorkflow**

Modify `frontend/src/utils/apiClient.ts`:

在 `aiApi` 对象内(第 510-551 行附近),`getDefaultModel` 之后追加:

```typescript
  /** AI 快速生成工作流 */
  generateWorkflow: (data: { description: string; mode: 'replace' | 'append'; model_id?: string }) =>
    request<WorkflowSaveRequest>('/ai/generate-workflow', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
```

- [ ] **Step 4: 在 canvasStore.ts 新增 fitViewToken + requestFitView + loadGeneratedWorkflow**

Modify `frontend/src/stores/canvasStore.ts`:

在 `CanvasState` interface 中(第 55-86 行附近)追加新字段和方法签名:

```typescript
  // fitView 触发(Canvas.tsx 监听 token 变化触发 reactFlowInstance.fitView)
  fitViewToken: number;
  requestFitView: () => void;

  // AI 快速生成:加载后端返回的 nodes/edges 到画布
  loadGeneratedWorkflow: (
    nodes: import('@/utils/apiClient').NodeCreateRequest[],
    edges: import('@/utils/apiClient').EdgeCreateRequest[],
    mode: 'replace' | 'append',
  ) => void;
```

在 store 实现(第 88 行 `create<CanvasState>((set, get) => ({` 之后)的合适位置(比如 `clearCanvas` 之后)追加实现:

```typescript
  fitViewToken: 0,

  requestFitView: () => {
    set((state) => ({ fitViewToken: state.fitViewToken + 1 }));
  },

  loadGeneratedWorkflow: (nodes, edges, mode) => {
    // 复用 canvasTransform 转换后端格式 → 前端 CanvasNode/CanvasEdge
    const { toCanvasNode, toCanvasEdge } = require('@/utils/canvasTransform') as typeof import('@/utils/canvasTransform');
    const newNodes = nodes.map(toCanvasNode);

    if (mode === 'replace') {
      // 替换:清空后加载(不广播,避免高频 emit)
      set({ nodes: newNodes, edges: edges.map(toCanvasEdge), selectedNodeId: null });
    } else {
      // 追加:保留现有节点,新节点直接 push;edges 的 id 加前缀避免冲突
      const existingIds = new Set(get().nodes.map((n) => n.id));
      const existingEdgeIds = new Set(get().edges.map((e) => e.id));
      const dedupedNodes = newNodes.filter((n) => !existingIds.has(n.id));
      const newEdges = edges
        .map((e, idx) => {
          const converted = toCanvasEdge(e);
          // 加前缀避免与现有 edge id 冲突
          return { ...converted, id: `gen-${converted.id}-${idx}` };
        })
        .filter((e) => !existingEdgeIds.has(e.id));

      set((state) => ({
        nodes: [...state.nodes, ...dedupedNodes],
        edges: [...state.edges, ...newEdges],
      }));
    }

    // 选中首个节点(便于用户立即查看属性)
    if (newNodes.length > 0) {
      set({ selectedNodeId: newNodes[0].id });
    }

    // 触发 fitView(Canvas.tsx 监听 fitViewToken 变化)
    get().requestFitView();

    // 标记脏状态(触发 autoSaveStore 防抖保存)
    useCollabStore.getState(); // 触发 collabStore 引用(避免 tree-shake)
  },
```

注意:由于 canvasStore.ts 已有 `import { useCollabStore, ... } from './collabStore';`,新增方法中的 `useCollabStore.getState()` 是合法的。但更优雅的做法是导入 `useAutoSaveStore` 来触发 markDirty。让我修正:

在 canvasStore.ts 文件顶部追加导入:

```typescript
import { useAutoSaveStore } from './autoSaveStore';
import { toCanvasNode, toCanvasEdge } from '@/utils/canvasTransform';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';
```

并把 `loadGeneratedWorkflow` 实现中的 `useCollabStore.getState(); // 触发 collabStore 引用(避免 tree-shake)` 替换为:

```typescript
    // 标记脏状态(触发 autoSaveStore 防抖保存)
    useAutoSaveStore.getState().markDirty();
```

并把 require 改为直接用顶部导入的 `toCanvasNode`/`toCanvasEdge`:

```typescript
  loadGeneratedWorkflow: (nodes, edges, mode) => {
    const newNodes = nodes.map(toCanvasNode);
    // ... 后续逻辑同上
  },
```

最终 `loadGeneratedWorkflow` 完整实现:

```typescript
  loadGeneratedWorkflow: (nodes, edges, mode) => {
    const newNodes = nodes.map(toCanvasNode);

    if (mode === 'replace') {
      set({ nodes: newNodes, edges: edges.map(toCanvasEdge), selectedNodeId: null });
    } else {
      const existingIds = new Set(get().nodes.map((n) => n.id));
      const existingEdgeIds = new Set(get().edges.map((e) => e.id));
      const dedupedNodes = newNodes.filter((n) => !existingIds.has(n.id));
      const newEdges = edges
        .map((e, idx) => {
          const converted = toCanvasEdge(e);
          return { ...converted, id: `gen-${converted.id}-${idx}` };
        })
        .filter((e) => !existingEdgeIds.has(e.id));

      set((state) => ({
        nodes: [...state.nodes, ...dedupedNodes],
        edges: [...state.edges, ...newEdges],
      }));
    }

    if (newNodes.length > 0) {
      set({ selectedNodeId: newNodes[0].id });
    }

    get().requestFitView();
    useAutoSaveStore.getState().markDirty();
  },
```

同时把 `CanvasState` interface 中的 `loadGeneratedWorkflow` 签名参数类型改为直接使用顶部导入的类型(去掉内联 import):

```typescript
  loadGeneratedWorkflow: (
    nodes: NodeCreateRequest[],
    edges: EdgeCreateRequest[],
    mode: 'replace' | 'append',
  ) => void;
```

- [ ] **Step 5: 运行 TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误(EXIT_CODE=0)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/canvasTransform.ts frontend/src/stores/projectStore.ts frontend/src/utils/apiClient.ts frontend/src/stores/canvasStore.ts
git commit -m "feat: 前端新增 AI 生成的 API/store/转换工具"
```

---

### Task 4: 前端 AiGenerateModal 组件

**Files:**
- Create: `frontend/src/components/AiGenerateModal.tsx`

**Interfaces:**
- Consumes: `aiApi.generateWorkflow(data)`(来自 Task 3);`canvasStore.loadGeneratedWorkflow(nodes, edges, mode)`(来自 Task 3);`NodeCreateRequest`/`EdgeCreateRequest` 类型
- Produces: `AiGenerateModal` React 组件,Props: `{ open: boolean; onClose: () => void; onGenerated: (nodes, edges, mode) => void }`

- [ ] **Step 1: 新建 AiGenerateModal.tsx**

Create `frontend/src/components/AiGenerateModal.tsx`:

```typescript
import { useState } from 'react';
import { X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { aiApi, type NodeCreateRequest, type EdgeCreateRequest } from '@/utils/apiClient';
import { toast } from 'sonner';

interface AiGenerateModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (nodes: NodeCreateRequest[], edges: EdgeCreateRequest[], mode: 'replace' | 'append') => void;
}

export default function AiGenerateModal({ open, onClose, onGenerated }: AiGenerateModalProps) {
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError('请输入工作流描述');
      return;
    }

    // 替换模式二次确认
    if (mode === 'replace') {
      const confirmed = window.confirm('替换模式将清空当前画布的所有节点和边,确定继续吗?');
      if (!confirmed) return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await aiApi.generateWorkflow({ description: description.trim(), mode });
      onGenerated(result.nodes, result.edges, mode);
      toast.success(`已生成 ${result.nodes.length} 个节点`);
      // 重置并关闭
      setDescription('');
      setError(null);
      onClose();
    } catch (err: any) {
      const msg = err?.message || '生成失败,请重试';
      setError(msg);
      // 不关闭模态框,保留输入内容便于重试
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter 提交
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="bg-canvas-panel border border-canvas-border rounded-xl w-[480px] shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-canvas-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-medium text-white font-display">AI 生成工作流</h3>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded hover:bg-canvas-hover text-slate-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {/* 描述输入 */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">工作流描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              autoFocus
              disabled={loading}
              placeholder='描述你想要的工作流,如"生成产品宣传视频:文本输入 → 文生图 → 图生视频 → 视频输出"'
              className="w-full px-3 py-2 text-sm bg-canvas-bg border border-canvas-border rounded-md text-slate-200 placeholder-slate-500 focus:outline-none focus:border-neon-purple resize-none disabled:opacity-50"
            />
            <p className="text-[10px] text-slate-600">Ctrl/⌘ + Enter 快速生成</p>
          </div>

          {/* 模式选择 */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-500 uppercase tracking-wider">生成模式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode('append')}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                  mode === 'append'
                    ? 'bg-neon-purple/20 border-neon-purple text-slate-200'
                    : 'bg-canvas-bg border-canvas-border text-slate-400 hover:border-canvas-hover'
                } disabled:opacity-50`}
              >
                追加到画布
                <span className="block text-[10px] text-slate-500 mt-0.5">保留现有节点</span>
              </button>
              <button
                onClick={() => setMode('replace')}
                disabled={loading}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                  mode === 'replace'
                    ? 'bg-red-500/20 border-red-500 text-slate-200'
                    : 'bg-canvas-bg border-canvas-border text-slate-400 hover:border-canvas-hover'
                } disabled:opacity-50`}
              >
                替换当前画布
                <span className="block text-[10px] text-slate-500 mt-0.5">清空后加载</span>
              </button>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-canvas-border">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !description.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-neon-purple to-neon-blue rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行 TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误(EXIT_CODE=0)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AiGenerateModal.tsx
git commit -m "feat: 新增 AI 生成模态框组件"
```

---

### Task 5: 前端 EditorLayout 接入 + Canvas fitView 监听

**Files:**
- Modify: `frontend/src/components/EditorLayout.tsx`(新增按钮 + state + 模态框渲染)
- Modify: `frontend/src/components/canvas/Canvas.tsx`(useEffect 监听 fitViewToken)

**Interfaces:**
- Consumes: `AiGenerateModal` 组件(来自 Task 4);`canvasStore.loadGeneratedWorkflow`/`fitViewToken`(来自 Task 3);`Sparkles` icon from lucide-react
- Produces: EditorLayout 工具栏新增「AI 生成」按钮 + 模态框;Canvas 在 fitViewToken 变化时触发 fitView

- [ ] **Step 1: 修改 EditorLayout.tsx 新增 AI 生成按钮和模态框**

Modify `frontend/src/components/EditorLayout.tsx`:

1. 在文件顶部 import 区追加(第 9 行附近):

```typescript
import { ArrowLeft, Save, Undo2, Redo2, Play, Square, History, Clock, Sparkles } from 'lucide-react';
import AiGenerateModal from './AiGenerateModal';
import type { NodeCreateRequest, EdgeCreateRequest } from '@/utils/apiClient';
```

2. 在 `EditorLayout` 函数内,`workflowStatus` state 之后追加新 state(第 53 行附近):

```typescript
  const [showAiModal, setShowAiModal] = useState(false);
```

3. 在 `handleCancelWorkflow` 之后追加 `handleAiGenerated` 回调:

```typescript
  const handleAiGenerated = (
    nodes: NodeCreateRequest[],
    edges: EdgeCreateRequest[],
    mode: 'replace' | 'append',
  ) => {
    useCanvasStore.getState().loadGeneratedWorkflow(nodes, edges, mode);
  };
```

4. 在工具栏的「执行工作流」按钮之前(第 277 行 `<div className="h-5 w-px bg-canvas-border" />` 之后)插入「AI 生成」按钮:

```tsx
        <div className="h-5 w-px bg-canvas-border" />

        <button
          onClick={() => setShowAiModal(true)}
          disabled={workflowStatus.state === 'running'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-neon-blue to-neon-purple rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          title="AI 生成工作流"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI 生成
        </button>

        <div className="h-5 w-px bg-canvas-border" />
```

注意:这里把原来分隔「保存」和「执行工作流」的单个 `<div className="h-5 w-px bg-canvas-border" />` 替换为「分隔 → AI 生成按钮 → 分隔」的结构。

5. 在 JSX 末尾(崩溃恢复对话框 `{showRecoveryDialog && ...}` 之后,`</div>` 闭合之前)追加模态框渲染:

```tsx
      {/* AI 生成模态框 */}
      <AiGenerateModal
        open={showAiModal}
        onClose={() => setShowAiModal(false)}
        onGenerated={handleAiGenerated}
      />
```

- [ ] **Step 2: 修改 Canvas.tsx 监听 fitViewToken**

Modify `frontend/src/components/canvas/Canvas.tsx`:

1. 在 `useCanvasStore()` 解构中加入 `fitViewToken`(第 30 行):

```typescript
  const { nodes, edges, setNodes, setEdges, setSelectedNode, addNode, fitViewToken } = useCanvasStore();
```

2. 在 `onDrop` useCallback 之后(第 176 行附近)追加 useEffect:

```typescript
  // 监听 fitViewToken 变化,触发 ReactFlow 自适应视图(AI 生成后用)
  useEffect(() => {
    if (fitViewToken === 0) return; // 跳过初始值
    if (reactFlowInstance.current) {
      reactFlowInstance.current.fitView({ padding: 0.2, duration: 300 });
    }
  }, [fitViewToken]);
```

3. 在文件顶部 import 中追加 `useEffect`:

```typescript
import { useCallback, useMemo, useRef, useEffect } from 'react';
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误(EXIT_CODE=0)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EditorLayout.tsx frontend/src/components/canvas/Canvas.tsx
git commit -m "feat: EditorLayout 接入 AI 生成按钮和模态框"
```

---

### Task 6: 端到端验证清单 + 最终 tsc 检查

**Files:**
- Create: `frontend/verify_ai_generate.md`

**Interfaces:**
- Consumes: 全部前 5 个 Task 的产出
- Produces: 人工验证清单文档,记录功能完整性

- [ ] **Step 1: 新建验证清单文档**

Create `frontend/verify_ai_generate.md`:

```markdown
# AI 快速生成 端到端验证清单

> 日期: 2026-06-29
> 模块: AI 快速生成(路线图阶段五 #12)
> 验证人: ___________

## 验证前准备

- [ ] 后端服务已启动(`cd backend && uvicorn app.main:app --reload`)
- [ ] 前端开发服务已启动(`cd frontend && npm run dev`)
- [ ] 已登录账户并打开任意项目进入编辑器
- [ ] 已在「设置」页配置至少 1 个 LLM 模型(model_type='llm',is_active=true)
- [ ] (可选)已配置 image_gen 类型模型(用于验证 AI 推理节点 model_id 预填)

## UI 验证

- [ ] 工具栏「执行工作流」按钮左侧出现「AI 生成」按钮(蓝色→紫色渐变,Sparkles 图标)
- [ ] 点击「AI 生成」按钮弹出模态框(居中,宽 480px,半透明遮罩)
- [ ] 模态框标题为「AI 生成工作流」,右上角有关闭按钮(X 图标)
- [ ] 模态框包含:描述 textarea(4 行)+ 模式选择(两个按钮)+ 生成按钮
- [ ] 默认模式为「追加到画布」(紫色边框)
- [ ] 点击「替换当前画布」切换为红色边框
- [ ] 描述为空时「生成」按钮 disabled
- [ ] 工作流执行中时「AI 生成」按钮 disabled

## 交互验证

- [ ] 模态框打开时 textarea 自动聚焦
- [ ] 点击遮罩区域(非模态框内)可关闭模态框(loading 时不可关闭)
- [ ] Ctrl/⌘ + Enter 快速触发生成
- [ ] 模态框关闭后再次打开,描述输入框已清空

## 功能验证 — 追加模式

- [ ] 在画布上预先放置 1 个节点(如文本输入)
- [ ] 打开 AI 生成模态框,输入「生成产品宣传视频:文本输入 → 文生图 → 图生视频 → 视频输出」
- [ ] 选择「追加到画布」模式
- [ ] 点击「生成」,按钮显示「生成中...」+ spinner
- [ ] 等待 5-15 秒(LLM 调用),模态框自动关闭
- [ ] 出现 toast 提示「已生成 N 个节点」
- [ ] 画布上原有节点保留,新增 N 个节点
- [ ] 节点之间有边连接(平滑曲线)
- [ ] 节点位置分层排列(输入在最左,输出在最右)
- [ ] 画布自动 fitView,所有节点可见
- [ ] 首个生成的节点被选中(属性面板显示其参数)

## 功能验证 — 替换模式

- [ ] 在画布上预先放置若干节点
- [ ] 打开 AI 生成模态框,输入工作流描述
- [ ] 选择「替换当前画布」模式
- [ ] 点击「生成」,弹出二次确认对话框「替换模式将清空当前画布...」
- [ ] 点击「取消」,模态框保持打开,画布不变
- [ ] 重新点击「生成」→ 确认 → 等待生成
- [ ] 画布上原有节点全部清除,只显示新生成的节点

## 参数预填验证

- [ ] 选中生成的 text_input 节点,属性面板「参数」区 `text` 字段值 = 用户输入的描述
- [ ] 选中生成的 text_to_image 节点,`prompt` 字段值 = 用户输入的描述
- [ ] (若已配置 image_gen 模型)text_to_image 节点的 `model_id` 字段已预填该模型 UUID
- [ ] (若未配置 image_gen 模型)text_to_image 节点的 `model_id` 字段为空(属性面板显示「自动选择」)
- [ ] 选中 video_output 节点,`format` 字段值为 `mp4`(默认值)

## 错误处理验证

- [ ] (断开后端)点击生成,模态框错误区显示红色提示「Failed to fetch」或类似网络错误
- [ ] 模态框保持打开,描述输入内容保留,可重试
- [ ] (在后端删除所有 LLM 模型)点击生成,错误区显示「未找到可用的 LLM 模型,请先在设置页配置」
- [ ] (LLM 返回非 JSON,可通过修改 system prompt 模拟)错误区显示「AI 返回格式异常,请重试」

## 后续动作验证

- [ ] 生成后画布状态变为「未保存」(底部状态栏黄色圆点)
- [ ] 等待 2 秒,自动保存触发(状态变绿)
- [ ] 点击「执行工作流」按钮,工作流正常执行(节点状态变为 running → completed)
- [ ] (若 LLM 生成的节点可执行)执行完成后 outputArtifacts 出现在属性面板

## 协作验证(可选)

- [ ] 在两个浏览器标签页打开同一项目
- [ ] 标签页 A 通过 AI 生成节点
- [ ] 标签页 B 自动同步看到新生成的节点(通过 canvasStore.applyRemoteNodeUpdate)

## 类型检查

- [ ] 运行 `cd frontend && npx tsc --noEmit`,EXIT_CODE=0

## 已知限制(本版本不支持)

- 多轮对话修改(「再加一个抠图节点」)— 不支持
- 生成后自动执行预览 — 不支持(需用户手动点「执行工作流」)
- 节点参数编辑后重新生成 — 不支持
- 控制节点(if_else/loop/merge)的复杂条件参数预填 — 不支持(LLM 仅生成结构,参数留默认)

## 验证结论

- 通过项: ___ / 35
- 待修复:
- 验证时间:
```

- [ ] **Step 2: 运行最终 TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误(EXIT_CODE=0)

- [ ] **Step 3: 运行后端单元测试**

Run: `cd backend && python -m pytest tests/test_ai_generate.py -v`
Expected: 4 个测试全部 PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/verify_ai_generate.md
git commit -m "docs: 新增 AI 快速生成验证清单"
```

---

## Self-Review

### 1. Spec coverage(对照设计文档逐项检查)

| 设计文档要求 | 对应 Task | 状态 |
|------|------|------|
| POST /api/v1/ai/generate-workflow endpoint | Task 2 | ✅ |
| `ai_service.generate_workflow(db, description, model_id)` | Task 1 | ✅ |
| 16 种节点白名单(与前端 NODE_TEMPLATES 一致) | Task 1(NODE_WHITELIST) | ✅ |
| system prompt 约束 JSON 输出 | Task 1(SYSTEM_PROMPT) | ✅ |
| LLM 返回 JSON 解析(容忍 ```json 包裹) | Task 1(_parse_llm_json) | ✅ |
| subtype 白名单校验 + 跳过非法节点 + warning 日志 | Task 1(generate_workflow 第 4 步) | ✅ |
| 生成 node id(`node-{ts}-{rand6}`) | Task 1(_generate_node_id) | ✅ |
| 拓扑分层布局(第 N 层 x=N*300,同层 y=index*150) | Task 1(_compute_layout) | ✅ |
| 预填 text_input.params.text = description | Task 1(generate_workflow 第 7 步) | ✅ |
| 预填 ai_inference.params.prompt = description + model_id | Task 1 | ✅ |
| 返回 {nodes, edges} 格式与 workflowApi.save 一致 | Task 1(返回 dict) | ✅ |
| 错误处理表(404/502/502/502/200) | Task 2(endpoint) | ✅ |
| apiClient.aiApi.generateWorkflow | Task 3 | ✅ |
| EditorLayout 工具栏新增「AI 生成」按钮 | Task 5 | ✅ |
| AiGenerateModal 组件(半透明遮罩 + 居中卡片 + textarea + 模式单选 + 错误提示 + loading) | Task 4 | ✅ |
| 替换模式二次确认 | Task 4(window.confirm) | ✅ |
| 生成成功后自动关闭模态框 + toast 提示 | Task 4 | ✅ |
| canvasStore.loadGeneratedWorkflow(mode) | Task 3 | ✅ |
| fitView({ padding: 0.2, duration: 300 }) | Task 3 + Task 5(fitViewToken 机制) | ✅ |
| 选中首个节点 | Task 3(setSelectedNodeId) | ✅ |
| 不引入新依赖(dagre) | 全程未引入 | ✅ |
| 不破坏自动保存/协作 | Task 3 调 markDirty + 不广播批量加载 | ✅ |
| Git commit 用简短中文 | 所有 commit 步骤 | ✅ |
| 后端单元测试 | Task 1(4 个测试) | ✅ |
| 人工验证清单 | Task 6(verify_ai_generate.md) | ✅ |

**Gaps:** 无遗漏。

### 2. Placeholder scan

搜索计划文档,检查以下红旗模式:
- "TBD" / "TODO" / "implement later" / "fill in details" — 无
- "Add appropriate error handling" / "add validation" / "handle edge cases" — 无,所有错误处理已具体到 HTTP 状态码和消息
- "Write tests for the above"(无具体测试代码)— 无,Task 1 含完整 4 个测试
- "Similar to Task N"(不重复代码)— 无,每个 Task 自包含
- 步骤只描述做什么不给代码 — 无,所有代码步骤含完整代码块
- 引用未定义的类型/函数/方法 — 已检查:
  - `generate_workflow` 在 Task 1 定义,Task 2 引用 ✅
  - `toCanvasNode`/`toCanvasEdge` 在 canvasTransform.ts(Task 3 Step 1)定义,Task 3 Step 2 引用 ✅
  - `aiApi.generateWorkflow` 在 Task 3 Step 3 定义,Task 4 引用 ✅
  - `canvasStore.loadGeneratedWorkflow`/`fitViewToken`/`requestFitView` 在 Task 3 Step 4 定义,Task 4/5 引用 ✅
  - `AiGenerateModal` 在 Task 4 定义,Task 5 引用 ✅

### 3. Type consistency

| 名称 | 定义位置 | 引用位置 | 一致性 |
|------|------|------|------|
| `generate_workflow(db, description, model_id) -> dict` | Task 1(ai_service.py) | Task 2(endpoint 调用) | ✅ |
| `GenerateWorkflowRequest{description, mode, model_id}` | Task 2(ai.py schema) | Task 3(apiClient.aiApi.generateWorkflow 入参) | ✅ |
| `GenerateWorkflowResponse{nodes, edges}` | Task 2(ai.py schema) | Task 3(apiClient 返回 WorkflowSaveRequest) | ✅(WorkflowSaveRequest 也是 {nodes, edges}) |
| `toCanvasNode(n: NodeCreateRequest): CanvasNode` | Task 3(canvasTransform.ts) | Task 3 Step 2(projectStore 导入) + Task 3 Step 4(canvasStore 导入) | ✅ |
| `toCanvasEdge(e: EdgeCreateRequest): CanvasEdge` | Task 3(canvasTransform.ts) | 同上 | ✅ |
| `aiApi.generateWorkflow(data): Promise<WorkflowSaveRequest>` | Task 3(apiClient.ts) | Task 4(AiGenerateModal 调用) | ✅ |
| `canvasStore.fitViewToken: number` | Task 3 Step 4 | Task 5 Step 2(Canvas.tsx 监听) | ✅ |
| `canvasStore.requestFitView(): void` | Task 3 Step 4 | Task 3 Step 4(loadGeneratedWorkflow 内部调用) | ✅ |
| `canvasStore.loadGeneratedWorkflow(nodes, edges, mode): void` | Task 3 Step 4 | Task 5 Step 1(handleAiGenerated 调用) | ✅ |
| `AiGenerateModalProps{open, onClose, onGenerated}` | Task 4 | Task 5(EditorLayout 渲染) | ✅ |
| `onGenerated(nodes: NodeCreateRequest[], edges: EdgeCreateRequest[], mode)` | Task 4 Props | Task 5 Step 1(handleAiGenerated 实现) | ✅ |

**Issues found & fixed:**
- 计划初稿中 `loadGeneratedWorkflow` 用了 `require()` 动态导入 — 已修正为顶部 `import` 静态导入(更符合 ES Module 规范)
- 计划初稿中 `useAutoSaveStore` 未在 canvasStore.ts 顶部导入 — 已在 Step 4 补充导入
- 计划初稿中 `CanvasState` interface 的 `loadGeneratedWorkflow` 签名用了内联 `import(...)` — 已改为顶部导入 `NodeCreateRequest`/`EdgeCreateRequest` 后直接引用

---

## Execution Handoff

计划已保存到 `docs/superpowers/plans/2026-06-29-ai-quick-generate.md`,共 6 个 Task,每个 Task 含完整代码和验证步骤。

两种执行选项:

**1. Subagent-Driven(推荐)** — 每个 Task 派发独立 subagent 执行,Task 间进行两阶段 review(实现质量 + Spec 对齐),快速迭代,主上下文保持干净

**2. Inline Execution** — 在当前会话内批量执行所有 Task,带 checkpoint review

**Which approach?**
