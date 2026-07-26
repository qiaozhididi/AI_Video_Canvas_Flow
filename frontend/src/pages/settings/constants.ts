// Settings 页共享常量与 helper 函数
// 从原 Settings.tsx 第 26-88 行迁移

export interface ProviderPreset {
  value: string;
  label: string;
  description: string;
  defaultBaseUrl: string;
  supportedTypes: string[];
  icon: string;
  color: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'volcengine', label: '火山引擎', description: '豆包系列、SeedReam 图片/视频生成', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', supportedTypes: ['llm', 'image_gen', 'video_gen', 'tts'], icon: '火', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'openai', label: 'OpenAI', description: 'GPT-4o, DALL·E, TTS 等', defaultBaseUrl: 'https://api.openai.com/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: 'O', color: 'bg-green-500/20 text-green-400' },
  { value: 'deepseek', label: 'DeepSeek', description: 'deepseek-chat, deepseek-reasoner', defaultBaseUrl: 'https://api.deepseek.com/v1', supportedTypes: ['llm'], icon: 'D', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'aliyun', label: '阿里云 DashScope', description: '通义千问 Qwen 系列', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: '阿', color: 'bg-violet-500/20 text-violet-400' },
  { value: 'zhipu', label: '智谱 BigModel', description: 'GLM-4, CogView 图片生成', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', supportedTypes: ['llm', 'image_gen'], icon: '智', color: 'bg-cyan-500/20 text-cyan-400' },
  { value: 'moonshot', label: '月之暗面 Moonshot', description: 'Kimi k2, moonshot-v1', defaultBaseUrl: 'https://api.moonshot.ai/v1', supportedTypes: ['llm'], icon: '月', color: 'bg-indigo-500/20 text-indigo-400' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude 3.5/4 系列', defaultBaseUrl: 'https://api.anthropic.com/v1', supportedTypes: ['llm'], icon: 'A', color: 'bg-amber-500/20 text-amber-400' },
  { value: 'gemini', label: 'Google Gemini', description: 'Gemini 2.5 Pro/Flash', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', supportedTypes: ['llm'], icon: 'G', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'azure_openai', label: 'Azure OpenAI', description: 'Azure 部署的 GPT 系列', defaultBaseUrl: 'https://{resource}.openai.azure.com', supportedTypes: ['llm', 'image_gen', 'tts'], icon: 'Az', color: 'bg-sky-500/20 text-sky-400' },
  { value: 'siliconflow', label: '硅基流动 SiliconFlow', description: 'DeepSeek-V3, FLUX 图片生成', defaultBaseUrl: 'https://api.siliconflow.cn/v1', supportedTypes: ['llm', 'image_gen', 'tts'], icon: '硅', color: 'bg-teal-500/20 text-teal-400' },
  { value: 'openrouter', label: 'OpenRouter', description: '聚合多平台模型路由', defaultBaseUrl: 'https://openrouter.ai/api/v1', supportedTypes: ['llm', 'image_gen'], icon: 'OR', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'hunyuan', label: '腾讯混元', description: 'hunyuan-turbo, 混元图片生成', defaultBaseUrl: 'https://hunyuan.cloud.tencent.com', supportedTypes: ['llm', 'image_gen'], icon: '混', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'minimax', label: 'MiniMax', description: 'abab7, TTS 语音合成', defaultBaseUrl: 'https://api.minimax.chat/v1', supportedTypes: ['llm', 'tts'], icon: 'MM', color: 'bg-pink-500/20 text-pink-400' },
  { value: 'qianfan', label: '百度千帆', description: 'ERNIE-4.0, 文心系列', defaultBaseUrl: 'https://qianfan.baidubce.com/v2', supportedTypes: ['llm'], icon: '千', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'qiniu', label: '七牛云', description: 'AI 推理服务', defaultBaseUrl: 'https://qiniuapi.com', supportedTypes: ['llm'], icon: '七', color: 'bg-lime-500/20 text-lime-400' },
  { value: 'nvidia', label: 'NVIDIA', description: 'NIM 推理服务', defaultBaseUrl: 'https://integrate.api.nvidia.com', supportedTypes: ['llm'], icon: 'NV', color: 'bg-green-500/20 text-green-400' },
  { value: 'novita', label: 'Novita AI', description: 'SDXL, FLUX 图片生成', defaultBaseUrl: 'https://api.novita.ai/v3', supportedTypes: ['llm', 'image_gen'], icon: 'No', color: 'bg-fuchsia-500/20 text-fuchsia-400' },
  { value: 'gpustack', label: 'GPUStack', description: '私有化部署推理服务', defaultBaseUrl: '', supportedTypes: ['llm'], icon: 'GP', color: 'bg-slate-500/20 text-slate-400' },
  { value: 'jina', label: 'Jina AI', description: 'Embedding, Rerank 服务', defaultBaseUrl: 'https://api.jina.ai/v1', supportedTypes: ['llm'], icon: 'J', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'mimo', label: '小米 MiMo', description: 'MiMo 推理模型', defaultBaseUrl: 'https://xiaomimimo.com', supportedTypes: ['llm'], icon: '米', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'modelscope', label: '魔搭 ModelScope', description: 'ModelScope 模型推理', defaultBaseUrl: 'https://modelscope.cn', supportedTypes: ['llm'], icon: '魔', color: 'bg-rose-500/20 text-rose-400' },
  { value: 'longcat', label: 'LongCat AI', description: '美团 LongCat 推理', defaultBaseUrl: 'https://longcat.chat', supportedTypes: ['llm'], icon: 'LC', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'lkeap', label: '腾讯云 LKEAP', description: '知识引擎原子能力', defaultBaseUrl: 'https://lkeap.cloud.tencent.com', supportedTypes: ['llm'], icon: 'LK', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'custom', label: '自定义 (OpenAI 兼容)', description: '自行配置 Base URL', defaultBaseUrl: '', supportedTypes: ['llm', 'image_gen', 'video_gen', 'tts'], icon: '+', color: 'bg-slate-500/20 text-slate-400' },
];

export const MODEL_TYPE_OPTIONS = [
  { value: 'llm', label: '文本生成', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'image_gen', label: '文生图', color: 'bg-purple-500/20 text-purple-400' },
  { value: 'video_gen', label: '图生视频', color: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'tts', label: '语音合成', color: 'bg-amber-500/20 text-amber-400' },
] as const;

export function modelTypeMeta(t: string) {
  return MODEL_TYPE_OPTIONS.find((o) => o.value === t) ?? { value: t, label: t, color: 'bg-slate-500/20 text-slate-400' };
}

export function platformLabel(t: string) {
  return PROVIDER_PRESETS.find((o) => o.value === t)?.label ?? t;
}

export function platformPreset(p: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((o) => o.value === p);
}

export function platformIcon(p: string) {
  return platformPreset(p)?.icon ?? p.charAt(0).toUpperCase();
}

export function platformColor(p: string) {
  return platformPreset(p)?.color ?? 'bg-slate-500/20 text-slate-400';
}
