// src/modules/ai/ai.service.ts
import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { AiProvider } from './entities/ai-provider.entity';
import { AiModel } from './entities/ai-model.entity';
import { ProviderCreateDto, ProviderUpdateDto, ModelCreateDto, ModelUpdateDto, GenerateWorkflowDto, GenerateSubtitlesDto } from './dto/ai.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');

  constructor(
    @InjectRepository(AiProvider) private providerRepo: Repository<AiProvider>,
    @InjectRepository(AiModel) private modelRepo: Repository<AiModel>,
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

  // ── AI API 调用 ──
  async callLlm(modelId: string, messages: any[], userId: string, temperature = 0.7): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'llm');
    try {
      const resp = await axios.post(
        `${provider.baseUrl}/chat/completions`,
        { model: model.modelId, messages, temperature, stream: false },
        { headers: { Authorization: `Bearer ${provider.apiKey}` }, timeout: 60000 },
      );
      return resp.data.choices[0].message.content;
    } catch (err) {
      this.logger.error(`LLM 调用失败: ${err.message}`);
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }
  }

  async callImageGen(modelId: string, params: any, userId: string): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'image_gen');
    try {
      const resp = await axios.post(
        `${provider.baseUrl}/images/generations`,
        {
          model: model.modelId,
          prompt: params.prompt,
          size: params.size || '1024x1024',
          response_format: 'url',
        },
        { headers: { Authorization: `Bearer ${provider.apiKey}` }, timeout: 120000 },
      );
      return resp.data.data[0].url;
    } catch (err) {
      this.logger.error(`图片生成失败: ${err.message}`);
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }
  }

  async callVideoGen(modelId: string, params: any, userId: string): Promise<string> {
    // Ark 异步 API: 提交任务 → 轮询 → 获取结果
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'video_gen');
    try {
      // 1. 提交任务
      const submitResp = await axios.post(
        `${provider.baseUrl}/contents/generations/tasks`,
        {
          model: model.modelId,
          content: [{ type: 'text', text: params.prompt }],
          image: params.image ? { url: params.image } : undefined,
        },
        { headers: { Authorization: `Bearer ${provider.apiKey}` }, timeout: 30000 },
      );
      const taskId = submitResp.data.id;

      // 2. 轮询 (最多 300 次 = 10 分钟)
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const statusResp = await axios.get(
          `${provider.baseUrl}/contents/generations/tasks/${taskId}`,
          { headers: { Authorization: `Bearer ${provider.apiKey}` }, timeout: 10000 },
        );
        if (statusResp.data.status === 'succeeded') {
          return statusResp.data.content.video_url;
        }
        if (statusResp.data.status === 'failed') {
          throw new Error('视频生成失败');
        }
      }
      throw new Error('视频生成超时');
    } catch (err) {
      this.logger.error(`视频生成失败: ${err.message}`);
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }
  }

  async callAudioGen(modelId: string, params: any, userId: string): Promise<string> {
    const { provider, model } = await this.getProviderAndModel(modelId, userId, 'tts');
    try {
      const resp = await axios.post(
        `${provider.baseUrl}/audio/speech`,
        {
          model: model.modelId,
          input: params.text || params.prompt,
          voice: params.voice || 'default',
        },
        { headers: { Authorization: `Bearer ${provider.apiKey}` }, timeout: 60000, responseType: 'arraybuffer' },
      );
      // 返回 base64
      return `data:audio/mpeg;base64,${Buffer.from(resp.data).toString('base64')}`;
    } catch (err) {
      this.logger.error(`TTS 失败: ${err.message}`);
      throw new Error('AI 服务暂时不可用，请稍后重试');
    }
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
