/**
 * Anthropic Claude LLM provider.
 * Uses dynamic import so @anthropic-ai/sdk is optional at build time.
 * @module @clawswarm/core/providers/anthropic
 */

import { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';
import { withTimeout } from '../utils/timeout.js';

const DEFAULT_TIMEOUT_MS = 120_000;

// Model name mappings
const MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4': 'claude-sonnet-4-20250514',
  'claude-opus-4': 'claude-opus-4-20250514',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
};

function resolveModel(model: string): string {
  return MODEL_MAP[model] ?? model;
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(model = 'claude-sonnet-4') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Anthropic provider requires ANTHROPIC_API_KEY environment variable.'
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = resolveModel(model);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let AnthropicSDK: any;
    try {
      const mod = await import('@anthropic-ai/sdk' as string);
      AnthropicSDK = mod.default ?? mod.Anthropic ?? mod;
    } catch {
      throw new Error(
        'Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk'
      );
    }

    const client = new AnthropicSDK({ apiKey: this.apiKey });
    const modelName = resolveModel(options?.model ?? this.defaultModel);

    // Extract system messages
    const systemMessages = messages.filter(m => m.role === 'system');
    const userMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const systemPrompt = systemMessages.map(m => m.content).join('\n\n');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestParams: Record<string, any> = {
      model: modelName,
      max_tokens: options?.maxTokens ?? 8192,
      messages: userMessages,
    };

    if (systemPrompt) {
      requestParams.system = systemPrompt;
    }

    if (options?.temperature !== undefined) {
      requestParams.temperature = options.temperature;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await withTimeout(
      client.messages.create(requestParams) as Promise<unknown>,
      timeoutMs,
      `AnthropicProvider.chat(${modelName})`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (response.content as any[])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text: string }) => block.text)
      .join('');

    return {
      content,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }
}
