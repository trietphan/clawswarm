/**
 * Google Gemini LLM provider.
 * @module @clawswarm/core/providers/google
 */

import { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from './types.js';

// Model name mappings — maps user-facing aliases to actual API model names
const MODEL_MAP: Record<string, string> = {
  'gemini-pro': 'gemini-2.5-flash',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-2.0-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash': 'gemini-2.5-flash',
};

function resolveModel(model: string): string {
  return MODEL_MAP[model] ?? model;
}

export class GoogleProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(inputModel = 'gemini-2.0-flash') {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Google Gemini provider requires GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable.'
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = resolveModel(inputModel);
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const modelName = resolveModel(options?.model ?? this.defaultModel);
    void genAI; // genAI used below via getGenerativeModel with system instruction

    // Separate system prompt from conversation
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const systemInstruction = systemMessages.map(m => m.content).join('\n\n');

    // Build Gemini chat history (all but the last user message)
    const history = conversationMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = conversationMessages[conversationMessages.length - 1];
    if (!lastMessage) {
      throw new Error('GoogleProvider: at least one non-system message is required.');
    }

    const generationConfig: Record<string, unknown> = {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens ?? 8192,
    };

    if (options?.responseFormat === 'json') {
      generationConfig.responseMimeType = 'application/json';
    }

    const modelWithSystem = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction || undefined,
      generationConfig,
    });

    const chat = modelWithSystem.startChat({ history });
    const result = await chat.sendMessage(lastMessage.content);
    const response = result.response;
    const text = response.text();

    const usage = response.usageMetadata;

    return {
      content: text,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          }
        : undefined,
    };
  }
}
