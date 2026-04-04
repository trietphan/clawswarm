/**
 * OpenAI LLM provider.
 * Uses dynamic import so openai is optional at build time.
 * @module @clawswarm/core/providers/openai
 */

import { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';
import { withTimeout } from '../utils/timeout.js';

const DEFAULT_TIMEOUT_MS = 120_000;

// Model name mappings
const MODEL_MAP: Record<string, string> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
};

function resolveModel(model: string): string {
  return MODEL_MAP[model] ?? model;
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(model = 'gpt-4o') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenAI provider requires OPENAI_API_KEY environment variable.'
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = resolveModel(model);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let OpenAISDK: any;
    try {
      const mod = await import('openai' as string);
      OpenAISDK = mod.default ?? mod.OpenAI ?? mod;
    } catch {
      throw new Error(
        'OpenAI SDK not installed. Run: npm install openai'
      );
    }

    const client = new OpenAISDK({ apiKey: this.apiKey });
    const modelName = resolveModel(options?.model ?? this.defaultModel);

    const openaiMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestParams: Record<string, any> = {
      model: modelName,
      messages: openaiMessages,
      max_tokens: options?.maxTokens ?? 8192,
    };

    if (options?.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    if (options?.responseFormat === 'json') {
      requestParams.response_format = { type: 'json_object' };
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await withTimeout(
      client.chat.completions.create(requestParams) as Promise<unknown>,
      timeoutMs,
      `OpenAIProvider.chat(${modelName})`
    );
    const choice = response.choices[0];

    return {
      content: choice.message.content ?? '',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}
