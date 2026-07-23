import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HfInference } from '@huggingface/inference';

export interface ReorderPrediction {
  reorder: boolean;
  suggestedQty: number;
  reason: string;
}

@Injectable()
export class HuggingFaceService {
  private readonly logger = new Logger(HuggingFaceService.name);
  private readonly client: HfInference | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('HF_API_KEY');
    this.client = apiKey ? new HfInference(apiKey) : null;
    if (!this.client) {
      this.logger.warn('HF_API_KEY not set — AI assistant disabled');
    }
  }

  async askAssistant(prompt: string, language: 'ar' | 'en' = 'en'): Promise<string> {
    if (!this.client) {
      return language === 'ar'
        ? 'المساعد الذكي غير متاح حالياً'
        : 'AI assistant is currently unavailable';
    }

    const system =
      language === 'ar'
        ? 'أنت مساعد ذكي متخصص في إدارة المستودعات. أجب باللغة العربية الفصحى.'
        : 'You are an intelligent warehouse management assistant. Be concise and factual.';

    try {
      const result = await this.client.chatCompletion({
        model: 'mistralai/Mistral-7B-Instruct-v0.3',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
      });
      return result.choices[0]?.message?.content?.trim() ?? '';
    } catch (err) {
      this.logger.error('HuggingFace chatCompletion failed', err);
      return language === 'ar'
        ? 'تعذّر الحصول على رد من المساعد الذكي'
        : 'Failed to get a response from the AI assistant';
    }
  }

  async predictReorder(productId: string): Promise<ReorderPrediction> {
    if (!this.client) {
      return { reorder: false, suggestedQty: 0, reason: 'AI unavailable' };
    }

    const prompt =
      `Warehouse product ID: "${productId}". Based on typical FMCG patterns, ` +
      `decide if a reorder is needed. Reply with ONLY valid JSON: ` +
      `{"reorder": boolean, "suggestedQty": number, "reason": string}`;

    try {
      const result = await this.client.chatCompletion({
        model: 'mistralai/Mistral-7B-Instruct-v0.3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 128,
      });
      const text = result.choices[0]?.message?.content?.trim() ?? '{}';
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return { reorder: false, suggestedQty: 0, reason: text };
      return JSON.parse(match[0]) as ReorderPrediction;
    } catch (err) {
      this.logger.error(`Reorder prediction failed for product ${productId}`, err);
      return { reorder: false, suggestedQty: 0, reason: 'Prediction failed' };
    }
  }
}
