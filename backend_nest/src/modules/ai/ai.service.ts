// src/modules/ai/ai.service.ts
import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
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
    const providers = await this.providerRepo.find({ where: { userId } });
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
  async listModels(userId: string, providerId?: string) {
    const where: any = {};
    if (providerId) where.providerId = providerId;
    // 关联查询 provider 获取 userId 过滤
    const models = await this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere(providerId ? 'model.provider_id = :providerId' : '1=1', { providerId })
      .getMany();
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

    if (dto.is_default) {
      // 按用户过滤，仅取消当前用户同类型的其他默认模型
      await this.modelRepo
        .createQueryBuilder()
        .update(AiModel)
        .set({ isDefault: false })
        .where('model_type = :modelType', { modelType: model.modelType })
        .andWhere('id != :modelId', { modelId })
        .andWhere(`provider_id IN (SELECT id FROM ai_providers WHERE user_id = :userId)`, { userId })
        .execute();
    }

    if (dto.display_name !== undefined) model.displayName = dto.display_name;
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
    const qb = this.modelRepo
      .createQueryBuilder('model')
      .innerJoin(AiProvider, 'provider', 'provider.id = model.provider_id')
      .where('provider.user_id = :userId', { userId })
      .andWhere('model.is_default = true')
      .andWhere('model.is_active = true');
    if (modelType) qb.andWhere('model.model_type = :modelType', { modelType });
    const model = await qb.getOne();
    if (!model) throw new NotFoundException('未找到可用的 AI 模型');
    return this.modelToResponse(model);
  }

  // ── 首次启动自动创建默认 AI 配置 ──
  async ensureDefaultAiConfig(userId: string) {
    const count = await this.providerRepo.count({ where: { userId } });
    if (count > 0) return;

    const defaultConfig = this.config.get('defaultAi')!;
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
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
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
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
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
      throw new Error(`AI 服务暂时不可用，请稍后重试`);
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

  // ── AI 生成工作流 ──
  async generateWorkflow(userId: string, dto: GenerateWorkflowDto) {
    const model = dto.model_id
      ? await this.modelRepo.findOne({ where: { id: dto.model_id } })
      : await this.getDefaultModel(userId, 'llm');
    if (!model) throw new NotFoundException('未找到可用的 LLM 模型');

    const systemPrompt = '你是一个工作流生成助手，根据用户描述生成 AI Canvas Flow 工作流 JSON。';
    const userPrompt = `请根据以下描述生成工作流: ${dto.description}`;
    const content = await this.callLlm(model.id, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], userId);

    // 解析 JSON (容错处理)
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { nodes: [], edges: [], raw: content };
    } catch {
      return { nodes: [], edges: [], raw: content };
    }
  }

  async generateSubtitles(userId: string, dto: GenerateSubtitlesDto) {
    const model = dto.model_id
      ? await this.modelRepo.findOne({ where: { id: dto.model_id } })
      : await this.getDefaultModel(userId, 'llm');
    if (!model) throw new NotFoundException('未找到可用的 LLM 模型');

    const content = await this.callLlm(model.id, [
      { role: 'system', content: '你是字幕生成助手，根据文本生成带时间戳的字幕分段 JSON。返回格式: {segments: [{start, end, text}]}' },
      { role: 'user', content: dto.prompt },
    ], userId);

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { segments: [] };
    } catch {
      return { segments: [] };
    }
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
