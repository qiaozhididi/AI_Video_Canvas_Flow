// src/modules/ai/ai.service.ts
import { Injectable, NotFoundException, ConflictException, Logger, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { AiProvider } from './entities/ai-provider.entity';
import { AiModel } from './entities/ai-model.entity';
import { MediaAsset } from '../media/entities/media-asset.entity';
import { MinioService } from '../../common/utils/minio.service';
import { ProviderCreateDto, ProviderUpdateDto, ModelCreateDto, ModelUpdateDto, GenerateWorkflowDto, GenerateSubtitlesDto } from './dto/ai.dto';

// ── AI 工作流生成常量（对齐 Python ai_service.py:545-645）──

const NODE_WHITELIST: Record<string, string> = {
  text_input: 'input',
  image_input: 'input',
  audio_input: 'input',
  text_to_image: 'ai_inference',
  image_to_image: 'ai_inference',
  image_to_video: 'ai_inference',
  text_to_speech: 'ai_inference',
  text_to_video: 'ai_inference',
  text_to_subtitle: 'ai_inference',
  upscale: 'processing',
  style_transfer: 'processing',
  remove_bg: 'processing',
  extend_image: 'processing',
  if_else: 'control',
  loop: 'control',
  merge: 'control',
  video_output: 'output',
  image_output: 'output',
  audio_output: 'output',
};

const NODE_DEFAULT_LABELS: Record<string, string> = {
  text_input: '文本输入',
  image_input: '图片输入',
  audio_input: '音频输入',
  text_to_image: '文生图',
  image_to_image: '图生图',
  image_to_video: '图生视频',
  text_to_speech: '文生语音',
  text_to_video: '文生视频',
  text_to_subtitle: 'AI 字幕',
  upscale: '高清放大',
  style_transfer: '风格化',
  remove_bg: '抠图',
  extend_image: '扩图',
  if_else: '条件分支',
  loop: '循环',
  merge: '合并',
  video_output: '视频输出',
  image_output: '图片输出',
  audio_output: '音频输出',
};

const NODE_DEFAULT_PARAMS: Record<string, any> = {
  text_input: { text: '' },
  image_input: { url: '' },
  audio_input: { url: '' },
  text_to_image: { prompt: '', size: '1024x1024' },
  image_to_image: { prompt: '', size: '1024x1024' },
  image_to_video: { prompt: '', duration: 5 },
  text_to_speech: { text: '', voice: 'default' },
  text_to_video: { prompt: '', duration: 5 },
  text_to_subtitle: { prompt: '', duration: 30 },
  upscale: { scale: 2 },
  style_transfer: { style: '' },
  remove_bg: {},
  extend_image: { direction: 'all' },
  if_else: { condition: '' },
  loop: { count: 1 },
  merge: {},
  video_output: { format: 'mp4' },
  image_output: { format: 'png' },
  audio_output: { format: 'mp3' },
};

const AI_INFERENCE_MODEL_TYPE: Record<string, string> = {
  text_to_image: 'image_gen',
  image_to_image: 'image_gen',
  image_to_video: 'video_gen',
  text_to_speech: 'tts',
  text_to_video: 'video_gen',
  text_to_subtitle: 'llm',
};

const SYSTEM_PROMPT = `你是 AI 视频工作流编排助手。根据用户描述生成工作流节点和连接。

合法节点类型(仅可使用以下 subtype):
- 输入:text_input(文本输入), image_input(图片输入), audio_input(音频输入)
- AI 推理:text_to_image(文生图), image_to_image(图生图), image_to_video(图生视频), text_to_speech(文生语音), text_to_video(文生视频)
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
`;

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    @InjectRepository(AiProvider) private providerRepo: Repository<AiProvider>,
    @InjectRepository(AiModel) private modelRepo: Repository<AiModel>,
    @InjectRepository(MediaAsset) private mediaRepo: Repository<MediaAsset>,
    private minioService: MinioService,
    private config: ConfigService,
  ) {}

  // ── Provider CRUD ──
  async listProviders(userId: string) {
    // I-16: 自动初始化默认配置（对齐 Python ai.py:107 ensure_default_ai_config）
    await this.ensureDefaultAiConfig(userId);
    const providers = await this.providerRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return providers.map(p => this.providerToResponse(p));
  }

  async createProvider(userId: string, dto: ProviderCreateDto) {
    const provider = this.providerRepo.create({
      id: uuidv4(),
      userId,
      name: dto.name,
      platform: dto.platform,
      baseUrl: dto.base_url,
      apiKey: dto.api_key,
    });
    await this.providerRepo.save(provider);
    return this.providerToResponse(provider);
  }

  async updateProvider(userId: string, providerId: string, dto: ProviderUpdateDto) {
    const provider = await this.providerRepo.findOne({ where: { id: providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');
    if (dto.name !== undefined) provider.name = dto.name;
    if (dto.platform !== undefined) provider.platform = dto.platform;  // I-28
    if (dto.base_url !== undefined) provider.baseUrl = dto.base_url;
    if (dto.api_key !== undefined) provider.apiKey = dto.api_key;
    if (dto.is_active !== undefined) provider.isActive = dto.is_active;
    await this.providerRepo.save(provider);
    return this.providerToResponse(provider);
  }

  async deleteProvider(userId: string, providerId: string) {
    // C5: 级联删除关联模型（对齐 Python ai.py:148-168）
    const provider = await this.providerRepo.findOne({ where: { id: providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');

    // 删除关联模型
    const models = await this.modelRepo.find({ where: { providerId } });
    if (models.length > 0) {
      await this.modelRepo.remove(models);
    }
    await this.providerRepo.remove(provider);
    return { message: `已删除 Provider 及其关联的 ${models.length} 个模型` };
  }

  // ── Model CRUD ──
  async listModels(userId: string, providerId?: string, modelType?: string) {
    const qb = this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId });
    if (providerId) qb.andWhere('model.provider_id = :providerId', { providerId });
    if (modelType) qb.andWhere('model.model_type = :modelType', { modelType });
    qb.orderBy('model.created_at', 'DESC');
    const models = await qb.getMany();
    return models.map(m => this.modelToResponse(m));
  }

  async createModel(userId: string, dto: ModelCreateDto) {
    // 校验 provider 属于当前用户
    const provider = await this.providerRepo.findOne({ where: { id: dto.provider_id, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');

    // 如果设为默认，先取消同类型的其他默认
    if (dto.is_default) {
      await this.modelRepo
        .createQueryBuilder()
        .update(AiModel)
        .set({ isDefault: false })
        .where('model_type = :modelType', { modelType: dto.model_type })
        .andWhere(`provider_id IN (SELECT id FROM ai_providers WHERE user_id = :userId)`, { userId })
        .execute();
    }

    const model = this.modelRepo.create({
      id: uuidv4(),
      providerId: dto.provider_id,
      modelId: dto.model_id,
      displayName: dto.display_name,
      modelType: dto.model_type,
      isDefault: dto.is_default || false,
    });
    await this.modelRepo.save(model);
    return this.modelToResponse(model);
  }

  async updateModel(userId: string, modelId: string, dto: ModelUpdateDto) {
    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('model.id = :modelId', { modelId })
      .andWhere('provider.user_id = :userId', { userId })
      .getOne();
    if (!model) throw new NotFoundException('AI 模型不存在');

    // I-18: 支持修改 provider_id（对齐 Python ai.py:243-253）
    if (dto.provider_id !== undefined) {
      const newProvider = await this.providerRepo.findOne({
        where: { id: dto.provider_id, userId },
      });
      if (!newProvider) throw new NotFoundException('AI 服务商不存在');
      model.providerId = dto.provider_id;
    }
    if (dto.model_id !== undefined) model.modelId = dto.model_id;
    if (dto.display_name !== undefined) model.displayName = dto.display_name;
    if (dto.model_type !== undefined) model.modelType = dto.model_type;

    if (dto.is_default) {
      await this.modelRepo
        .createQueryBuilder()
        .update(AiModel)
        .set({ isDefault: false })
        .where('model_type = :modelType', { modelType: model.modelType })
        .andWhere('id != :modelId', { modelId })
        .andWhere(`provider_id IN (SELECT id FROM ai_providers WHERE user_id = :userId)`, { userId })
        .execute();
    }
    if (dto.is_active !== undefined) model.isActive = dto.is_active;
    if (dto.is_default !== undefined) model.isDefault = dto.is_default;
    await this.modelRepo.save(model);
    return this.modelToResponse(model);
  }

  async deleteModel(userId: string, modelId: string) {
    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('model.id = :modelId', { modelId })
      .andWhere('provider.user_id = :userId', { userId })
      .getOne();
    if (!model) throw new NotFoundException('AI 模型不存在');
    await this.modelRepo.delete({ id: modelId });
  }

  async getDefaultModel(userId: string, modelType?: string) {
    // 1. 优先查找 is_default=True 的模型
    const qb = this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('provider.is_active = true')
      .andWhere('model.is_default = true')
      .andWhere('model.is_active = true');
    if (modelType) qb.andWhere('model.model_type = :modelType', { modelType });
    let model = await qb.getOne();

    // I-17: 无默认模型则回退到第一个 active 模型（对齐 Python ai.py:320-331）
    if (!model) {
      const fallbackQb = this.modelRepo
        .createQueryBuilder('model')
        .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
        .where('provider.user_id = :userId', { userId })
        .andWhere('provider.is_active = true')
        .andWhere('model.is_active = true');
      if (modelType) fallbackQb.andWhere('model.model_type = :modelType', { modelType });
      fallbackQb.orderBy('model.created_at', 'DESC').limit(1);
      model = await fallbackQb.getOne();
    }

    if (!model) {
      const typeHint = modelType ? `（类型: ${modelType}）` : '';
      throw new NotFoundException(`未找到可用的 AI 模型${typeHint}，请先在设置页配置`);
    }
    return this.modelToResponse(model);
  }

  // ── 首次启动自动创建默认 AI 配置 ──
  async ensureDefaultAiConfig(userId: string) {
    const count = await this.providerRepo.count({ where: { userId } });
    if (count > 0) return;

    const defaultConfig = this.config.get('defaultAi')!;
    // M11: apiKey 为空时跳过自动初始化（对齐 Python ai.py:360-362）
    // 避免创建一个 apiKey 为空的 Provider，导致后续 AI 调用 401 但报错信息不友好
    if (!defaultConfig.apiKey) {
      this.logger.warn('DEFAULT_AI_API_KEY 未配置，跳过默认 AI 配置自动初始化');
      return;
    }

    const provider = this.providerRepo.create({
      id: uuidv4(),
      userId,
      name: defaultConfig.providerName,
      platform: defaultConfig.platform,
      baseUrl: defaultConfig.baseUrl,
      apiKey: defaultConfig.apiKey,
    });
    await this.providerRepo.save(provider);

    const model = this.modelRepo.create({
      id: uuidv4(),
      providerId: provider.id,
      modelId: defaultConfig.modelId,
      displayName: defaultConfig.modelDisplayName,
      modelType: defaultConfig.modelType,
      isDefault: true,
    });
    await this.modelRepo.save(model);
    this.logger.log(`为用户 ${userId} 创建默认 AI 配置`);
  }

  // ── AI API 调用（对齐 Python ai_service.py:169-535）──

  /** 文生图：返回 { url, revised_prompt }，url 已转存 MinIO */
  async callImageGen(modelId: string, params: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    const size = this.normalizeImageSize(params?.size);

    const body: any = {
      model: model.modelId,
      prompt: params.prompt,
      size,
      n: params.n || 1,
    };

    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/images/generations`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 },
      );
      return await this.handleImageResponse(resp.data, userId);
    } catch (err) {
      this.logger.error(`文生图失败: ${(err as Error).message}`);
      throw new Error(`图片 API 调用失败: ${(err as Error).message}`);
    }
  }

  /** C11: 图生图（对齐 Python call_img2img）*/
  async callImg2Img(modelId: string, prompt: string, imageUrl: string, params: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    const apiImage = await this.resolveImageUrl(imageUrl);
    const size = this.normalizeImageSize(params?.size);

    const body: any = {
      model: model.modelId,
      prompt,
      image: apiImage,
      size,
      n: params.n || 1,
    };

    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/images/generations`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 },
      );
      return await this.handleImageResponse(resp.data, userId);
    } catch (err) {
      this.logger.error(`图生图失败: ${(err as Error).message}`);
      throw new Error(`图片 API 调用失败: ${(err as Error).message}`);
    }
  }

  /** C12: 视频生成（对齐 Python _call_ark_async，image 在 content 数组中）*/
  async callVideoGen(modelId: string, params: any, userId: string): Promise<{ video_url: string; remote_task_id?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'video_gen');
    const baseUrl = provider.baseUrl.replace(/\/$/, '');

    // C12: content 数组格式（对齐 Python ai_service.py:456-460）
    const content: any[] = [{ type: 'text', text: params.prompt }];
    if (params.image) {
      const resolvedUrl = await this.resolveImageUrl(params.image);
      content.push({ type: 'image_url', image_url: { url: resolvedUrl } });
    }

    const body = { model: model.modelId, content };

    try {
      // 1. 提交异步任务
      const submitResp = await axios.post(
        `${baseUrl}/contents/generations/tasks`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      const remoteTaskId = submitResp.data.id;
      if (!remoteTaskId) throw new Error(`视频生成 API 未返回任务 ID`);

      // 2. 轮询
      const resultData = await this.pollArkTask(baseUrl, provider.apiKey, remoteTaskId);

      // 3. 提取 video_url
      const videoUrl = this.extractArkMediaUrl(resultData, 'video');

      // 4. 下载转存 MinIO（C10/C12: 持久化失败时降级使用原始 URL，对齐 Python _call_ark_async 与 handleImageResponse）
      let persistentUrl: string;
      try {
        persistentUrl = await this.downloadToMinio(videoUrl, userId, `${remoteTaskId}.mp4`, 'video/mp4');
      } catch (e) {
        this.logger.warn(`视频 MinIO 持久化失败，使用原始 URL: ${(e as Error).message}`);
        persistentUrl = videoUrl;
      }
      return { video_url: persistentUrl, remote_task_id: remoteTaskId };
    } catch (err) {
      this.logger.error(`视频生成失败: ${(err as Error).message}`);
      throw new Error(`视频生成 API 调用失败: ${(err as Error).message}`);
    }
  }

  /** C10: TTS（对齐 Python call_audio_gen，改用 Ark 异步任务 + MinIO 持久化）*/
  async callAudioGen(modelId: string, params: any, userId: string): Promise<{ audio_url: string; remote_task_id?: string }> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'tts');
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const text = params.text || params.prompt || '';

    const body = {
      model: model.modelId,
      content: [{ type: 'text', text }],
    };

    try {
      const submitResp = await axios.post(
        `${baseUrl}/contents/generations/tasks`,
        body,
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      const remoteTaskId = submitResp.data.id;
      if (!remoteTaskId) throw new Error(`TTS API 未返回任务 ID`);

      const resultData = await this.pollArkTask(baseUrl, provider.apiKey, remoteTaskId);
      const audioUrl = this.extractArkMediaUrl(resultData, 'audio');

      // C10: 持久化失败时降级使用原始 URL，对齐 Python _call_ark_async 与 handleImageResponse
      let persistentUrl: string;
      try {
        persistentUrl = await this.downloadToMinio(audioUrl, userId, `${remoteTaskId}.mp3`, 'audio/mpeg');
      } catch (e) {
        this.logger.warn(`音频 MinIO 持久化失败，使用原始 URL: ${(e as Error).message}`);
        persistentUrl = audioUrl;
      }
      return { audio_url: persistentUrl, remote_task_id: remoteTaskId };
    } catch (err) {
      this.logger.error(`TTS 失败: ${(err as Error).message}`);
      throw new Error(`TTS API 调用失败: ${(err as Error).message}`);
    }
  }

  /** LLM 调用（添加 temperature 参数）*/
  async callLlm(modelId: string, messages: any[], userId: string, temperature = 0.7): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'llm');
    try {
      const resp = await axios.post(
        `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`,
        { model: model.modelId, messages, temperature },
        { headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 },
      );
      return resp.data.choices[0].message.content;
    } catch (err) {
      this.logger.error(`LLM 调用失败: ${(err as Error).message}`);
      throw new Error(`LLM API 调用失败: ${(err as Error).message}`);
    }
  }

  // ── 辅助方法（对齐 Python ai_service.py:104-414）──

  /** 处理图片 API 响应：转存 MinIO + 创建 MediaAsset */
  private async handleImageResponse(data: any, userId: string): Promise<{ url: string; revised_prompt?: string }> {
    if (!data?.data?.length) throw new Error(`图片生成 API 返回格式异常`);
    const imageData = data.data[0];
    const remoteUrl = imageData.url || '';
    const revisedPrompt = imageData.revised_prompt || '';

    if (!remoteUrl) return { url: '', revised_prompt: revisedPrompt };

    try {
      const persistentUrl = await this.downloadToMinio(remoteUrl, userId, `${uuidv4()}.png`, 'image/png');
      return { url: persistentUrl, revised_prompt: revisedPrompt };
    } catch (err) {
      this.logger.warn(`MinIO 持久化失败，使用原始 URL: ${(err as Error).message}`);
      return { url: remoteUrl, revised_prompt: revisedPrompt };
    }
  }

  /** 解析图片 URL：内部 /api/v1/media/{id}/download 路径转 base64，外部 URL 原样返回 */
  private async resolveImageUrl(imageUrl: string): Promise<string> {
    if (!imageUrl.startsWith('/api/v1/media/')) return imageUrl;

    try {
      const parts = imageUrl.replace(/^\//, '').split('/');
      const mediaId = parts[3] || parts[parts.length - 1].split('?')[0];
      const asset = await this.mediaRepo.findOne({ where: { id: mediaId } });
      if (!asset) return imageUrl;

      const presignedUrl = await this.minioService.getPresignedUrl(asset.storageKey, 1);
      const resp = await axios.get(presignedUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const b64 = Buffer.from(resp.data).toString('base64');
      const mime = asset.fileType || 'image/png';
      return `data:${mime};base64,${b64}`;
    } catch (err) {
      this.logger.warn(`图片转换失败: ${(err as Error).message}`);
      return imageUrl;
    }
  }

  /** 下载外部 URL 到 MinIO + 创建 MediaAsset，返回 /api/v1/media/{id}/download */
  private async downloadToMinio(url: string, userId: string, filename: string, contentType: string): Promise<string> {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 5 } as any);
    const buffer = Buffer.from(resp.data);
    const storageKey = `ai_gen/${userId}/${uuidv4()}/${filename}`;

    await this.minioService.uploadFile(storageKey, buffer, contentType);

    const mediaAsset = this.mediaRepo.create({
      id: uuidv4(),
      ownerId: userId,
      projectId: undefined,
      fileName: filename,
      fileType: contentType,
      fileSize: buffer.length,
      storageKey,
    });
    await this.mediaRepo.save(mediaAsset);
    return `/api/v1/media/${mediaAsset.id}/download`;
  }

  /** 轮询 Ark 异步任务直到完成 */
  private async pollArkTask(baseUrl: string, apiKey: string, taskId: string, timeout = 300000, interval = 5000): Promise<any> {
    const url = `${baseUrl}/contents/generations/tasks/${taskId}`;
    const headers = { Authorization: `Bearer ${apiKey}` };
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const resp = await axios.get(url, { headers, timeout: 30000 });
      const data = resp.data;
      const status = data.status || '';

      if (status === 'succeeded') return data;
      if (['failed', 'expired', 'cancelled'].includes(status)) {
        throw new Error(`任务 ${taskId} 状态异常: ${status}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`任务 ${taskId} 轮询超时(${timeout / 1000}s)`);
  }

  /** 从 Ark 异步任务结果提取媒体 URL（对齐 Python _extract_ark_media_url）*/
  private extractArkMediaUrl(resultData: any, mediaType: 'video' | 'audio'): string {
    const urlField = `${mediaType}_url`;
    let mediaUrl: string | undefined;

    // 格式1：content.{media_type}_url
    const content = resultData.content;
    if (content && typeof content === 'object') {
      mediaUrl = content[urlField];
    }

    // 格式2：choices[].message.content
    if (!mediaUrl && Array.isArray(resultData.choices)) {
      for (const choice of resultData.choices) {
        const msgContent = choice.message?.content;
        if (typeof msgContent === 'string' && msgContent.startsWith('http')) {
          mediaUrl = msgContent;
          break;
        }
        if (Array.isArray(msgContent)) {
          for (const item of msgContent) {
            if (item?.type === urlField) {
              mediaUrl = item[urlField]?.url;
            } else if (item?.type === 'file_url') {
              mediaUrl = item.file_url?.url;
            }
            if (mediaUrl) break;
          }
        }
        if (mediaUrl) break;
      }
    }

    // 格式3：data[].url
    if (!mediaUrl && Array.isArray(resultData.data) && resultData.data.length > 0) {
      mediaUrl = resultData.data[0].url || resultData.data[0][urlField];
    }

    if (!mediaUrl) {
      throw new Error(`${mediaType}生成任务成功但未找到 ${mediaType} URL`);
    }
    return mediaUrl;
  }

  /** 规范化图片 size 参数（对齐 Python _call_image_api:190-195）*/
  private normalizeImageSize(size?: string): string {
    const rawSize = size || '2k';
    const validSizes = new Set([
      '1k', '2k', '4k',
      '512x512', '768x768', '1024x1024', '1280x720', '720x1280',
      '1536x1536', '2048x2048', '1024x1536', '1536x1024',
    ]);
    return validSizes.has(String(rawSize)) ? String(rawSize) : '2k';
  }

  private async getProviderAndModel(
    modelId: string,
    userId: string,
    expectedType?: string,
  ): Promise<{ provider: AiProvider; model: AiModel }> {
    const model = await this.modelRepo.findOne({ where: { id: modelId } });
    if (!model) throw new NotFoundException('AI 模型不存在');

    // C15: 校验 model_type（对齐 Python ai_service.py:42-46）
    if (expectedType && model.modelType !== expectedType) {
      throw new ConflictException(
        `模型 ${model.displayName} 类型为 ${model.modelType}，期望 ${expectedType}。请在设置页配置 ${expectedType} 类型的模型。`,
      );
    }

    const provider = await this.providerRepo.findOne({ where: { id: model.providerId, userId } });
    if (!provider) throw new NotFoundException('AI 服务商不存在');

    // C15: 校验 is_active（对齐 Python ai_service.py:57-58）
    if (!provider.isActive || !model.isActive) {
      throw new ConflictException('AI Provider/Model 已禁用');
    }

    return { provider, model };
  }

  // ── AI 生成工作流（对齐 Python ai_service.py:801-916）──
  async generateWorkflow(userId: string, dto: GenerateWorkflowDto) {
    // 1. 获取 LLM 模型（dto.model_id 或默认 LLM）
    const llmModelId = await this.getDefaultLlmModelId(userId, dto.model_id);

    // 2. 调 LLM
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: dto.description },
    ];
    this.logger.log(`[AI:Generate] 调用 LLM 生成工作流, description=${dto.description.slice(0, 50)}`);
    const rawResponse = await this.callLlm(llmModelId, messages, userId, 0.3);

    // 3. 解析 JSON
    const data = this.parseLlmJson(rawResponse);

    // 4. 校验 subtype 白名单 + 生成新 ID
    const validNodes: any[] = [];
    const origToNew: Record<string, string> = {};
    let skipped = 0;

    for (const n of data.nodes) {
      const origId = n.id || `n${validNodes.length + 1}`;
      const subtype = n.subtype || '';
      if (!NODE_WHITELIST[subtype]) {
        this.logger.warn(`[AI:Generate] 跳过非法 subtype: id=${origId}, subtype=${subtype}`);
        skipped++;
        continue;
      }
      const newId = this.generateNodeId();
      validNodes.push({
        orig_id: origId,
        subtype,
        label: n.label || NODE_DEFAULT_LABELS[subtype] || subtype,
        new_id: newId,
      });
      origToNew[origId] = newId;
    }

    if (validNodes.length === 0) {
      throw new ConflictException('AI 生成内容无效:全部节点 subtype 非法');
    }

    // 5. 过滤 edges + 重映射 id
    const validEdges: any[] = [];
    for (const e of data.edges) {
      const src = e.from || '';
      const tgt = e.to || '';
      if (origToNew[src] && origToNew[tgt]) {
        validEdges.push({ from: src, to: tgt });
      }
    }

    // 6. 计算布局（Kahn 拓扑分层）
    this.computeLayout(validNodes, validEdges);

    // 7. 预填参数 + 组装最终节点
    // 7.1 批量预取 AI 推理节点的默认模型 ID（按 model_type 去重，一次性查询，避免循环内 N+1）
    const INFERENCE_SUBTYPES = ['text_to_image', 'image_to_image', 'image_to_video', 'text_to_speech'];
    const inferenceModelTypes = Array.from(
      new Set(
        validNodes
          .filter(n => INFERENCE_SUBTYPES.includes(n.subtype))
          .map(n => AI_INFERENCE_MODEL_TYPE[n.subtype])
          .filter((t): t is string => Boolean(t)),
      ),
    );
    const modelTypeToModelId = await this.getDefaultModelsForTypes(userId, inferenceModelTypes);

    // 7.2 组装最终节点（从 Map 取值，不再访问 DB）
    const resultNodes: any[] = [];
    for (const n of validNodes) {
      const nodeType = NODE_WHITELIST[n.subtype];
      const params = { ...NODE_DEFAULT_PARAMS[n.subtype] };

      // 预填: text_input.params.text = description
      if (n.subtype === 'text_input') {
        params.text = dto.description;
      }
      // 预填: AI 推理节点 params.prompt = description + model_id
      else if (INFERENCE_SUBTYPES.includes(n.subtype)) {
        params.prompt = dto.description;
        const modelType = AI_INFERENCE_MODEL_TYPE[n.subtype];
        if (modelType) {
          const defaultModel = modelTypeToModelId.get(modelType) || null;
          if (defaultModel) {
            params.model_id = defaultModel;
          }
        }
      }

      resultNodes.push({
        id: n.new_id,
        node_type: nodeType,
        label: n.label,
        position_x: n.position_x,
        position_y: n.position_y,
        config: {
          type: nodeType,
          subtype: n.subtype,
          label: n.label,
          params,
          status: 'idle',
          progress: 0,
          outputArtifacts: [],
        },
      });
    }

    // 8. 组装最终边
    const resultEdges = validEdges.map(e => ({
      id: this.generateEdgeId(),
      source_node_id: origToNew[e.from],
      target_node_id: origToNew[e.to],
      source_port: null,
      target_port: null,
    }));

    this.logger.log(`[AI:Generate] 生成完成: ${resultNodes.length} 节点, ${resultEdges.length} 边, 跳过 ${skipped} 非法`);
    return { nodes: resultNodes, edges: resultEdges };
  }

  /** 获取默认 LLM 模型 ID（对齐 Python _get_default_llm_model_id）*/
  private async getDefaultLlmModelId(userId: string, modelId?: string): Promise<string> {
    if (modelId) return modelId;

    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.model_type = :modelType', { modelType: 'llm' })
      .andWhere('model.is_active = true')
      .orderBy('model.created_at', 'ASC')
      .limit(1)
      .getOne();

    if (!model) {
      throw new NotFoundException('未找到可用的 LLM 模型,请先在设置页配置 model_type=llm 的 active 模型');
    }
    return model.id;
  }

  /** 查找指定 model_type 的首个 active 模型 ID（对齐 Python _get_default_model_for_type）*/
  private async getDefaultModelForType(userId: string, modelType: string): Promise<string | null> {
    const model = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.model_type = :modelType', { modelType })
      .andWhere('model.is_active = true')
      .orderBy('model.created_at', 'ASC')
      .limit(1)
      .getOne();
    return model?.id || null;
  }

  /** 批量查找多个 model_type 的首个 active 模型 ID（避免循环内 N+1 查询）。
   *  与 getDefaultModelForType 等价：按 created_at ASC 排序取每个 model_type 的首个。*/
  private async getDefaultModelsForTypes(
    userId: string,
    modelTypes: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (modelTypes.length === 0) return result;

    const models = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.model_type IN (:...modelTypes)', { modelTypes })
      .andWhere('model.is_active = true')
      .orderBy('model.created_at', 'ASC')
      .getMany();

    // 已按 created_at ASC 排序，每个 model_type 取首个即可
    for (const m of models) {
      if (!result.has(m.modelType)) {
        result.set(m.modelType, m.id);
      }
    }
    return result;
  }

  /** 解析 LLM 返回的 JSON（容忍 markdown 代码块）*/
  private parseLlmJson(raw: string): any {
    let text = raw.trim();
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      text = lines[lines.length - 1].trim() === '```'
        ? lines.slice(1, -1).join('\n')
        : lines.slice(1).join('\n');
      text = text.trim();
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new ConflictException(`AI 返回格式异常,无法解析为 JSON: ${(e as Error).message}`);
    }

    if (typeof data !== 'object' || data === null) {
      throw new ConflictException('AI 返回格式异常:顶层应为 JSON 对象');
    }
    if (!Array.isArray(data.nodes)) {
      throw new ConflictException('AI 返回格式异常:缺少 nodes 数组');
    }
    if (!Array.isArray(data.edges)) {
      throw new ConflictException('AI 返回格式异常:缺少 edges 数组');
    }
    return data;
  }

  /** 生成节点 ID: node-{timestamp_ms}-{rand6} */
  private generateNodeId(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `node-${ts}-${rand}`;
  }

  /** 生成边 ID: edge-{timestamp_ms}-{rand6} */
  private generateEdgeId(): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `edge-${ts}-${rand}`;
  }

  /** Kahn 拓扑分层计算 position（对齐 Python _compute_layout）*/
  private computeLayout(validNodes: any[], edges: any[]): void {
    const idToIdx: Record<string, number> = {};
    validNodes.forEach((n, i) => { idToIdx[n.orig_id] = i; });

    // 入度 + 邻接表
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    validNodes.forEach(n => {
      inDegree[n.orig_id] = 0;
      adj[n.orig_id] = [];
    });

    for (const e of edges) {
      const src = e.from;
      const tgt = e.to;
      if (src in inDegree && tgt in inDegree) {
        adj[src].push(tgt);
        inDegree[tgt]++;
      }
    }

    // Kahn 分层
    const layer: Record<string, number> = {};
    validNodes.forEach(n => { layer[n.orig_id] = 0; });

    const queue: string[] = [];
    for (const id in inDegree) {
      if (inDegree[id] === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const nid = queue.shift()!;
      processed++;
      for (const child of adj[nid]) {
        layer[child] = Math.max(layer[child], layer[nid] + 1);
        inDegree[child]--;
        if (inDegree[child] === 0) queue.push(child);
      }
    }

    // 环检测
    if (processed < validNodes.length) {
      this.logger.warn('[AI:Generate] 检测到环,使用 fallback 布局');
      validNodes.forEach((n, i) => {
        n.position_x = i * 300;
        n.position_y = 0;
      });
      return;
    }

    // 按 layer 分组
    const byLayer: Record<string, any[]> = {};
    validNodes.forEach(n => {
      const l = layer[n.orig_id];
      if (!byLayer[l]) byLayer[l] = [];
      byLayer[l].push(n);
    });

    for (const layerNum in byLayer) {
      byLayer[layerNum].sort((a, b) => a.orig_id.localeCompare(b.orig_id));
      byLayer[layerNum].forEach((n, idx) => {
        n.position_x = Number(layerNum) * 300;
        n.position_y = idx * 150;
      });
    }
  }

  // ── AI 生成字幕（对齐 Python ai.py:460-490）──
  async generateSubtitles(userId: string, dto: GenerateSubtitlesDto) {
    const modelId = await this.getDefaultLlmModelId(userId, dto.model_id);
    const duration = dto.duration || 30;

    const subtitleSystemPrompt = `你是一个专业的字幕生成助手。根据用户提供的文本内容，生成带时间轴的字幕分段。

输出严格的 JSON 格式（不要 markdown 代码块，不要额外文字）：
{"segments":[{"start":0.0,"end":3.5,"text":"第一句字幕"},{"start":3.5,"end":7.0,"text":"第二句字幕"}]}

规则：
1. start/end 为秒数，从 0 开始
2. 每段字幕 2-5 秒，根据语义自然断句
3. 所有段时间总和应接近总时长 duration
4. 段与段时间连续，不重叠不间隔
5. text 使用中文
`;

    const messages = [
      { role: 'system', content: subtitleSystemPrompt },
      { role: 'user', content: `文本内容：${dto.prompt}\n总时长（秒）：${duration}` },
    ];

    const content = await this.callLlm(modelId, messages, userId, 0.3);

    // 解析 JSON（容忍 markdown 代码块）
    let text = content.trim();
    if (text.startsWith('```')) {
      const lines = text.split('\n');
      text = lines[lines.length - 1].trim() === '```'
        ? lines.slice(1, -1).join('\n')
        : lines.slice(1).join('\n');
      text = text.trim();
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new HttpException(`AI 返回格式异常: ${(e as Error).message}`, 422);
    }

    const segments = data.segments || [];
    if (segments.length === 0) {
      throw new HttpException('AI 未生成字幕分段', 422);
    }
    return { segments };
  }

  private providerToResponse(p: AiProvider) {
    return {
      id: p.id, user_id: p.userId, name: p.name, platform: p.platform,
      base_url: p.baseUrl, api_key: p.apiKey ? '***' : '', is_active: p.isActive,
      created_at: p.createdAt?.toISOString(), updated_at: p.updatedAt?.toISOString(),
    };
  }

  private modelToResponse(m: AiModel) {
    return {
      id: m.id, provider_id: m.providerId, model_id: m.modelId, display_name: m.displayName,
      model_type: m.modelType, is_active: m.isActive, is_default: m.isDefault,
      created_at: m.createdAt?.toISOString(), updated_at: m.updatedAt?.toISOString(),
    };
  }
}
