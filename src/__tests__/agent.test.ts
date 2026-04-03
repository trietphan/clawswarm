/**
 * Unit tests for the Agent class and factory methods.
 * Covers: construction, config validation, name/type getters,
 * system prompt generation, canHandle, and factory methods.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../core/agent.js';
import type { AgentConfig, Task, Deliverable } from '../core/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    type: 'custom',
    model: 'gpt-4o',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Agent — construction', () => {
  it('assigns a unique id per instance', () => {
    const a = new Agent(makeConfig());
    const b = new Agent(makeConfig());
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('starts in idle status', () => {
    const agent = new Agent(makeConfig());
    expect(agent.status).toBe('idle');
  });

  it('stores the config reference', () => {
    const config = makeConfig({ type: 'code', model: 'claude-sonnet-4' });
    const agent = new Agent(config);
    expect(agent.config).toBe(config);
  });

  it('currentTaskId is undefined initially', () => {
    const agent = new Agent(makeConfig());
    expect(agent.currentTaskId).toBeUndefined();
  });

  it('status can be mutated (busy ↔ idle cycle)', () => {
    const agent = new Agent(makeConfig({ type: 'research' }));
    agent.status = 'busy';
    expect(agent.status).toBe('busy');
    agent.status = 'idle';
    expect(agent.status).toBe('idle');
  });
});

describe('Agent — name getter', () => {
  it('uses config.name when provided', () => {
    const agent = new Agent(makeConfig({ name: 'MyAgent' }));
    expect(agent.name).toBe('MyAgent');
  });

  it('defaults to ResearchClaw for type=research', () => {
    const agent = new Agent(makeConfig({ type: 'research' }));
    expect(agent.name).toBe('ResearchClaw');
  });

  it('defaults to CodeClaw for type=code', () => {
    const agent = new Agent(makeConfig({ type: 'code' }));
    expect(agent.name).toBe('CodeClaw');
  });

  it('defaults to OpsClaw for type=ops', () => {
    const agent = new Agent(makeConfig({ type: 'ops' }));
    expect(agent.name).toBe('OpsClaw');
  });

  it('defaults to Planner for type=planner', () => {
    const agent = new Agent(makeConfig({ type: 'planner' }));
    expect(agent.name).toBe('Planner');
  });

  it('defaults to CustomAgent for type=custom', () => {
    const agent = new Agent(makeConfig({ type: 'custom' }));
    expect(agent.name).toBe('CustomAgent');
  });
});

describe('Agent — type getter', () => {
  it('returns the correct type from config', () => {
    const types = ['research', 'code', 'ops', 'planner', 'custom'] as const;
    for (const type of types) {
      const agent = new Agent(makeConfig({ type }));
      expect(agent.type).toBe(type);
    }
  });
});

describe('Agent — getSystemPrompt()', () => {
  it('returns custom systemPrompt when set in config', () => {
    const agent = new Agent(makeConfig({ systemPrompt: 'You are a custom bot.' }));
    expect(agent.getSystemPrompt()).toBe('You are a custom bot.');
  });

  it('returns default research prompt when not overridden', () => {
    const agent = new Agent(makeConfig({ type: 'research' }));
    const prompt = agent.getSystemPrompt();
    expect(prompt).toContain('ResearchClaw');
    expect(prompt.length).toBeGreaterThan(20);
  });

  it('returns default code prompt mentioning CodeClaw', () => {
    const agent = new Agent(makeConfig({ type: 'code' }));
    expect(agent.getSystemPrompt()).toContain('CodeClaw');
  });

  it('returns default ops prompt mentioning OpsClaw', () => {
    const agent = new Agent(makeConfig({ type: 'ops' }));
    expect(agent.getSystemPrompt()).toContain('OpsClaw');
  });

  it('returns default planner prompt mentioning Planner', () => {
    const agent = new Agent(makeConfig({ type: 'planner' }));
    expect(agent.getSystemPrompt()).toContain('Planner');
  });
});

describe('Agent — canHandle()', () => {
  it('returns true by default for any task', () => {
    const agent = new Agent(makeConfig());
    const fakeTask = { id: 'task-1', title: 'Whatever' } as unknown as Task;
    expect(agent.canHandle(fakeTask)).toBe(true);
  });

  it('can be overridden in a subclass to restrict tasks', () => {
    class SelectiveAgent extends Agent {
      canHandle(task: Task): boolean {
        return task.title.startsWith('code:');
      }
    }

    const agent = new SelectiveAgent(makeConfig({ type: 'code' }));
    const codeTask = { id: 't1', title: 'code: add feature' } as unknown as Task;
    const otherTask = { id: 't2', title: 'research: AI trends' } as unknown as Task;

    expect(agent.canHandle(codeTask)).toBe(true);
    expect(agent.canHandle(otherTask)).toBe(false);
  });
});

describe('Agent — execute()', () => {
  it('throws with helpful message when not overridden', async () => {
    const agent = new Agent(makeConfig({ type: 'code', name: 'TestAgent' }));
    const fakeTask = { id: 'task-xyz', title: 'something' } as unknown as Task;
    await expect(agent.execute(fakeTask)).rejects.toThrow(/must be implemented/i);
    await expect(agent.execute(fakeTask)).rejects.toThrow('TestAgent');
    await expect(agent.execute(fakeTask)).rejects.toThrow('task-xyz');
  });

  it('subclass can override execute to return deliverables', async () => {
    class EchoAgent extends Agent {
      async execute(task: Task): Promise<Deliverable[]> {
        return [{ type: 'text', label: 'Echo', content: task.title }];
      }
    }

    const agent = new EchoAgent(makeConfig({ type: 'custom' }));
    const fakeTask = { id: 't1', title: 'hello world' } as unknown as Task;
    const result = await agent.execute(fakeTask);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('hello world');
  });
});

describe('Agent — factory methods', () => {
  it('Agent.research() returns correct config with default tools', () => {
    const config = Agent.research({ model: 'claude-sonnet-4' });
    expect(config.type).toBe('research');
    expect(config.name).toBe('ResearchClaw');
    expect(config.tools).toEqual(expect.arrayContaining(['web_search', 'web_fetch']));
  });

  it('Agent.research() allows overriding name', () => {
    const config = Agent.research({ model: 'claude-sonnet-4', name: 'CustomResearcher' });
    expect(config.name).toBe('CustomResearcher');
  });

  it('Agent.code() returns correct config with default tools', () => {
    const config = Agent.code({ model: 'gpt-4o' });
    expect(config.type).toBe('code');
    expect(config.name).toBe('CodeClaw');
    expect(config.tools).toEqual(expect.arrayContaining(['read_file', 'write_file', 'run_tests']));
  });

  it('Agent.ops() returns correct config with default tools', () => {
    const config = Agent.ops({ model: 'gemini-pro' });
    expect(config.type).toBe('ops');
    expect(config.name).toBe('OpsClaw');
    expect(config.tools).toEqual(expect.arrayContaining(['shell', 'docker']));
  });

  it('Agent.planner() returns correct config with empty tools', () => {
    const config = Agent.planner({ model: 'claude-opus-4' });
    expect(config.type).toBe('planner');
    expect(config.name).toBe('Planner');
    expect(config.tools).toHaveLength(0);
  });

  it('factory configs can be used to instantiate Agent', () => {
    const config = Agent.code({ model: 'gpt-4o' });
    const agent = new Agent(config);
    expect(agent.type).toBe('code');
    expect(agent.name).toBe('CodeClaw');
    expect(agent.status).toBe('idle');
  });
});
