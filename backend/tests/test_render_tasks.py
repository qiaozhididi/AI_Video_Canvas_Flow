"""render_tasks 工具函数与配置完整性单元测试

覆盖:
1. _extract_text_from_artifacts — 从 input_artifacts 提取文本
2. _extract_image_url — 从 input_artifacts 提取图片 URL
3. AI_TASK_CONFIG — 配置完整性（所有 task_type 含必要 key）
4. _extract_text_from_artifacts 边界场景（空/None/混合）
"""

import pytest

from app.tasks.render_tasks import (
    _extract_text_from_artifacts,
    _extract_image_url,
    AI_TASK_CONFIG,
)


# ── _extract_text_from_artifacts ──


def test_extract_text_empty_artifacts():
    """None 或空列表应返回空字符串"""
    assert _extract_text_from_artifacts(None) == ""
    assert _extract_text_from_artifacts([]) == ""


def test_extract_text_from_text_field():
    """优先提取 text 字段"""
    artifacts = [
        {"text": "你好", "url": "/api/v1/media/abc"},
        {"text": "世界", "url": "/api/v1/media/def"},
    ]
    assert _extract_text_from_artifacts(artifacts) == "你好 世界"


def test_extract_text_from_text_input_artifact():
    """filename=text_input 且 url 非http 时，从 url 提取文本"""
    artifacts = [
        {"filename": "text_input", "url": "这是一段文本"},
    ]
    assert _extract_text_from_artifacts(artifacts) == "这是一段文本"


def test_extract_text_skip_http_url_text_input():
    """filename=text_input 但 url 是 http 链接时，不提取（属于文件 URL 非文本）"""
    artifacts = [
        {"filename": "text_input", "url": "https://example.com/file.txt"},
    ]
    assert _extract_text_from_artifacts(artifacts) == ""


def test_extract_text_mixed():
    """混合 artifact：text 字段 + text_input + 无文本"""
    artifacts = [
        {"text": "第一段"},
        {"filename": "text_input", "url": "第二段"},
        {"url": "https://example.com/image.png"},  # 无 text，非 text_input
    ]
    assert _extract_text_from_artifacts(artifacts) == "第一段 第二段"


# ── _extract_image_url ──


def test_extract_image_url_empty():
    """None 或空列表应返回 None"""
    assert _extract_image_url(None) is None
    assert _extract_image_url([]) is None


def test_extract_image_url_from_media_path():
    """从 /media/ 路径提取图片 URL"""
    artifacts = [{"url": "/api/v1/media/abc-123"}]
    assert _extract_image_url(artifacts) == "/api/v1/media/abc-123"


def test_extract_image_url_from_image_path():
    """从 /image/ 路径提取图片 URL"""
    artifacts = [{"url": "/api/v1/image/xyz"}]
    assert _extract_image_url(artifacts) == "/api/v1/image/xyz"


def test_extract_image_url_from_http():
    """从 http/https 链接提取图片 URL"""
    artifacts = [{"url": "https://example.com/image.png"}]
    assert _extract_image_url(artifacts) == "https://example.com/image.png"


def test_extract_image_url_skip_non_image():
    """非图片路径应返回 None"""
    artifacts = [{"url": "/api/v1/render/abc"}]
    assert _extract_image_url(artifacts) is None


def test_extract_image_url_returns_first_match():
    """多个图片 URL 时返回第一个"""
    artifacts = [
        {"url": "/api/v1/media/first"},
        {"url": "/api/v1/media/second"},
    ]
    assert _extract_image_url(artifacts) == "/api/v1/media/first"


# ── AI_TASK_CONFIG 配置完整性 ──


REQUIRED_CONFIG_KEYS = {
    "default_prompt", "needs_image", "result_key",
    "fallback_msg", "has_size_param", "has_size_retry",
}


def test_ai_task_config_has_all_required_task_types():
    """AI_TASK_CONFIG 应包含所有 ai_ 前缀的 task_type"""
    expected_types = {
        "ai_text2img", "ai_img2img", "ai_img2video",
        "ai_text2video", "ai_tts", "ai_subtitle",
    }
    assert set(AI_TASK_CONFIG.keys()) == expected_types


def test_ai_task_config_each_entry_has_required_keys():
    """每个 task_type 配置应包含所有必要 key"""
    for task_type, config in AI_TASK_CONFIG.items():
        missing = REQUIRED_CONFIG_KEYS - set(config.keys())
        assert not missing, f"task_type={task_type} 缺少配置 key: {missing}"


def test_ai_task_config_result_key_consistency():
    """result_key 应为有效字段名"""
    valid_result_keys = {"url", "video_url", "audio_url", "segments"}
    for task_type, config in AI_TASK_CONFIG.items():
        assert config["result_key"] in valid_result_keys, \
            f"task_type={task_type} result_key={config['result_key']} 不在有效集合中"


def test_ai_task_config_image_tasks_have_size_param():
    """文生图/图生图应有 size 参数（has_size_param=True）"""
    assert AI_TASK_CONFIG["ai_text2img"]["has_size_param"] is True
    assert AI_TASK_CONFIG["ai_img2img"]["has_size_param"] is True


def test_ai_task_config_video_tasks_no_size_param():
    """视频/语音/字幕任务不应有 size 参数"""
    for task_type in ("ai_img2video", "ai_text2video", "ai_tts", "ai_subtitle"):
        assert AI_TASK_CONFIG[task_type]["has_size_param"] is False, \
            f"task_type={task_type} 不应有 size 参数"


def test_ai_task_config_image_tasks_have_size_retry():
    """仅文生图/图生图应支持 size 重试"""
    for task_type, config in AI_TASK_CONFIG.items():
        if task_type in ("ai_text2img", "ai_img2img"):
            assert config["has_size_retry"] is True, \
                f"task_type={task_type} 应支持 size 重试"
        else:
            assert config["has_size_retry"] is False, \
                f"task_type={task_type} 不应支持 size 重试"


def test_ai_task_config_needs_image_consistency():
    """needs_image=True 的任务 fallback_msg 应提示缺少模型（包含'未配置'）"""
    for task_type, config in AI_TASK_CONFIG.items():
        if config["needs_image"]:
            assert "未配置" in config["fallback_msg"], \
                f"task_type={task_type} needs_image=True 但 fallback_msg 未提示缺少模型"
