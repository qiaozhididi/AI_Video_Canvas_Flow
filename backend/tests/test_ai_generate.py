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


@pytest.mark.asyncio
async def test_generate_workflow_prefills_model_id_for_ai_inference():
    """AI 推理节点应预填 model_id(当存在对应 model_type 的 active 模型时)"""
    fake_llm_response = '''{"nodes":[
        {"id":"n1","subtype":"text_input","label":"文本输入"},
        {"id":"n2","subtype":"text_to_image","label":"文生图"}
    ],"edges":[
        {"from":"n1","to":"n2"}
    ]}'''

    with patch('app.services.ai_service.call_llm', new_callable=AsyncMock) as mock_llm:
        mock_llm.return_value = fake_llm_response
        # mock 默认模型查询:返回 fake model UUID
        with patch('app.services.ai_service._get_default_model_for_type', new_callable=AsyncMock) as mock_default:
            mock_default.return_value = "fake-image-gen-uuid"
            result = await generate_workflow(db=None, description="测试", model_id="fake-llm-uuid")

    assert len(result["nodes"]) == 2
    n2 = result["nodes"][1]
    # AI 推理节点应预填 model_id
    assert n2["config"]["params"]["model_id"] == "fake-image-gen-uuid"
    # prompt 也应预填为 description
    assert n2["config"]["params"]["prompt"] == "测试"
