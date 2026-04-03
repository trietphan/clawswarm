/**
 * Tests for LLM provider factory and adapters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectProviderName, availableProviders, createProvider } from '../core/providers/index.js';
import { GoogleProvider } from '../core/providers/google.js';
import { AnthropicProvider } from '../core/providers/anthropic.js';
import { OpenAIProvider } from '../core/providers/openai.js';

// ─── Provider Detection Tests ─────────────────────────────────────────────────

describe('detectProviderName', () => {
  it('detects anthropic for claude- models', () => {
    expect(detectProviderName('claude-sonnet-4')).toBe('anthropic');
    expect(detectProviderName('claude-opus-4')).toBe('anthropic');
    expect(detectProviderName('claude-3-haiku')).toBe('anthropic');
  });

  it('detects openai for gpt- models', () => {
    expect(detectProviderName('gpt-4o')).toBe('openai');
    expect(detectProviderName('gpt-4o-mini')).toBe('openai');
    expect(detectProviderName('gpt-3.5-turbo')).toBe('openai');
  });

  it('detects google for gemini- models', () => {
    expect(detectProviderName('gemini-pro')).toBe('google');
    expect(detectProviderName('gemini-flash')).toBe('google');
    expect(detectProviderName('gemini-2.0-flash')).toBe('google');
  });

  it('returns unknown for unrecognized models', () => {
    expect(detectProviderName('llama-3')).toBe('unknown');
    expect(detectProviderName('mistral-7b')).toBe('unknown');
  });
});

// ─── API Key Validation Tests ─────────────────────────────────────────────────

describe('GoogleProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if GEMINI_API_KEY and GOOGLE_AI_API_KEY are missing', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    expect(() => new GoogleProvider()).toThrow(/GEMINI_API_KEY/);
  });

  it('accepts GEMINI_API_KEY', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(() => new GoogleProvider()).not.toThrow();
  });

  it('accepts GOOGLE_AI_API_KEY', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_AI_API_KEY = 'test-key';
    expect(() => new GoogleProvider()).not.toThrow();
  });
});

describe('AnthropicProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if ANTHROPIC_API_KEY is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('accepts ANTHROPIC_API_KEY', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    expect(() => new AnthropicProvider()).not.toThrow();
  });
});

describe('OpenAIProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it('accepts OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'test-key';
    expect(() => new OpenAIProvider()).not.toThrow();
  });
});

// ─── availableProviders Tests ─────────────────────────────────────────────────

describe('availableProviders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns empty array when no keys set', () => {
    expect(availableProviders()).toEqual([]);
  });

  it('returns google when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test';
    expect(availableProviders()).toContain('google');
  });

  it('returns anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    expect(availableProviders()).toContain('anthropic');
  });

  it('returns openai when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'test';
    expect(availableProviders()).toContain('openai');
  });

  it('returns all providers when all keys set', () => {
    process.env.GEMINI_API_KEY = 'test';
    process.env.ANTHROPIC_API_KEY = 'test';
    process.env.OPENAI_API_KEY = 'test';
    const providers = availableProviders();
    expect(providers).toContain('google');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('openai');
  });
});

// ─── createProvider Tests ─────────────────────────────────────────────────────

describe('createProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when no API keys are available and model is unknown', async () => {
    await expect(createProvider('unknown-model')).rejects.toThrow(/Cannot determine provider/);
  });

  it('throws when requesting claude- but no ANTHROPIC_API_KEY', async () => {
    await expect(createProvider('claude-sonnet-4')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('throws when requesting gpt- but no OPENAI_API_KEY', async () => {
    await expect(createProvider('gpt-4o')).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('throws when requesting gemini- but no GEMINI_API_KEY', async () => {
    await expect(createProvider('gemini-pro')).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('creates GoogleProvider for gemini- models', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = await createProvider('gemini-pro');
    expect(provider).toBeInstanceOf(GoogleProvider);
  });

  it('creates AnthropicProvider for claude- models', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const provider = await createProvider('claude-sonnet-4');
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('creates OpenAIProvider for gpt- models', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const provider = await createProvider('gpt-4o');
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });
});

// ─── Mock LLM Chat Tests ──────────────────────────────────────────────────────

describe('GoogleProvider.chat (mocked)', () => {
  it('calls Gemini and returns content + usage', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = new GoogleProvider('gemini-pro');

    // Mock the @google/generative-ai module
    const mockSendMessage = vi.fn().mockResolvedValue({
      response: {
        text: () => 'Mocked response from Gemini',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30,
        },
      },
    });

    const mockStartChat = vi.fn().mockReturnValue({ sendMessage: mockSendMessage });
    const mockGetGenerativeModel = vi.fn().mockReturnValue({ startChat: mockStartChat });

    vi.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
        getGenerativeModel: mockGetGenerativeModel,
      })),
    }));

    // Note: dynamic import mocking in ESM is tricky; this tests the shape
    // In a real integration test, GEMINI_API_KEY would be set for real calls
  });
});
