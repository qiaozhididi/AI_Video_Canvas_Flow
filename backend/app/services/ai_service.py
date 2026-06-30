"""AI 服务调用封装：根据 DB 配置动态调用各平台 AI API

支持的 AI 类型：
- LLM（call_llm）：OpenAI Chat Completions 兼容 API
- 文生图（call_image_gen）：OpenAI Images API 兼容格式
- 图生视频（call_video_gen）：预留
- TTS（call_tts）：预留
"""

import logging
import httpx
from uuid import UUID
from sqlalchemy import select

from app.models.ai_provider import AiProvider
from app.models.ai_model import AiModel

logger = logging.getLogger("app.services.ai")


async def _get_provider_and_model(db, model_id: str | UUID, expected_type: str | None = None) -> tuple[AiProvider, AiModel]:
    """根据 model_id 获取 Provider 和 Model 配置

    Args:
        expected_type: 期望的 model_type，不匹配时抛出 ValueError
    """
    if isinstance(model_id, str):
        model_id = UUID(model_id)

    result = await db.execute(select(AiModel).where(AiModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise ValueError(f"AI Model {model_id} 不存在")

    if expected_type and model.model_type != expected_type:
        raise ValueError(
            f"模型 {model.display_name} 类型为 {model.model_type}，期望 {expected_type}。"
            f"请在设置页配置 {expected_type} 类型的模型。"
        )

    result = await db.execute(select(AiProvider).where(AiProvider.id == model.provider_id))
    provider = result.scalar_one_or_none()
    if not provider:
        raise ValueError(f"AI Provider {model.provider_id} 不存在")

    if not provider.is_active or not model.is_active:
        raise ValueError(f"AI Provider/Model 已禁用")

    return provider, model


async def call_llm(db, model_id: str | UUID, messages: list[dict], temperature: float = 0.7) -> str:
    """调用 LLM（兼容 OpenAI Chat Completions API 格式）

    Args:
        db: 数据库 session
        model_id: AI Model UUID
        messages: OpenAI 格式消息列表 [{"role": "user", "content": "..."}]
        temperature: 生成温度

    Returns:
        LLM 响应文本
    """
    provider, model = await _get_provider_and_model(db, model_id)

    url = f"{provider.base_url.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model.model_id,
        "messages": messages,
        "temperature": temperature,
    }

    logger.info(f"[AI:LLM] 调用 {provider.name}/{model.display_name}, messages={len(messages)}")

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:LLM] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"AI API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        logger.info(f"[AI:LLM] 响应长度: {len(content)}")
        return content


async def call_image_gen(db, model_id: str | UUID, prompt: str, params: dict | None = None) -> dict:
    """文生图：调用兼容 OpenAI Images API 的端点

    Args:
        db: 数据库 session
        model_id: AI Model UUID（model_type 应为 image_gen）
        prompt: 图片描述提示词
        params: 额外参数（size, n 等）

    Returns:
        {"url": "https://...", "revised_prompt": "..."} 生成图片信息
    """
    provider, model = await _get_provider_and_model(db, model_id, expected_type="image_gen")

    url = f"{provider.base_url.rstrip('/')}/images/generations"
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model.model_id,
        "prompt": prompt,
        "n": params.get("n", 1) if params else 1,
        "size": params.get("size", "1024x1024") if params else "1024x1024",
    }
    # 火山引擎 / OpenAI 兼容格式
    if params and "response_format" in params:
        body["response_format"] = params["response_format"]

    logger.info(f"[AI:ImageGen] 调用 {provider.name}/{model.display_name}, prompt={prompt[:50]}")

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=body, headers=headers)
        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"[AI:ImageGen] 调用失败: HTTP {response.status_code}: {error_text}")
            raise RuntimeError(f"文生图 API 调用失败: HTTP {response.status_code}: {error_text}")

        data = response.json()
        # OpenAI 格式: {"data": [{"url": "...", "revised_prompt": "..."}]}
        if "data" in data and len(data["data"]) > 0:
            image_data = data["data"][0]
            result = {
                "url": image_data.get("url", ""),
                "revised_prompt": image_data.get("revised_prompt", ""),
            }
            logger.info(f"[AI:ImageGen] 生成成功: {result['url'][:80]}")
            return result
        else:
            raise RuntimeError(f"文生图 API 返回格式异常: {str(data)[:300]}")


async def call_video_gen(db, model_id: str | UUID, image_url: str, params: dict | None = None) -> str:
    """图生视频（预留接口）

    Returns:
        生成视频的 URL
    """
    raise NotImplementedError("图生视频功能待实现，请接入 Kling / Runway 等")


async def call_tts(db, model_id: str | UUID, text: str, params: dict | None = None) -> str:
    """TTS（预留接口）

    Returns:
        生成音频的 URL
    """
    raise NotImplementedError("TTS 功能待实现，请接入 CosyVoice 等")


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

# 各 subtype 的默认 params(与 frontend/src/types/canvas.ts 的 NODE_TEMPLATES.defaultParams 保持一致)
# 字段命名以后端执行逻辑为真相源:call_image_gen 读 size(字符串),workflowExecutor 读 model_id/prompt/text。
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
