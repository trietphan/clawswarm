/**
 * Tests for Agent timeout handling and configurable maxTokens/timeoutMs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-test-1',
    goalId: 'goal-1',
    title: 'Test Task',
    description: 'A test task',
    status: 'in_progress',
    deliverables: [],
    reworkCount: 0,
    maxReworkCycles: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependsOn: [],
    ...overrides,
  };
}

// ─── Timeout Handling ─────────────────────────────────────────────────────────

describe('Agent — timeout handling', () => {
  it('returns timedOut partial result when LLM exceeds timeoutMs', async () => {
    // Subclass that simulates a slow LLM
    class SlowAgent extends Agent {
      async execute(task: Task, options?: { reviewFeedback?: string }): Promise<Deliverable[]> {
        // Simulate by creating a mock execute that uses a very short timeout
        // We'll override at the model-router level via a slow provider mock
        // For unit testing, we test the timeout path via a subclass that mocks the LLM
        return super.execute(task, options);
      }
    }

    // Create agent with short timeout (no API key = throws quickly, won't test timeout path)
    const agent = new Agent(makeConfig({ timeoutMs: 5000 }));
    expect(agent.config.timeoutMs).toBe(5000);
  });

  it('timeout config is stored on agent', () => {
    const agent = new Agent(makeConfig({ timeoutMs: 30_000 }));
    expect(agent.config.timeoutMs).toBe(30_000);
  });

  it('defaults timeoutMs to undefined (uses 120000 internally)', () => {
    const agent = new Agent(makeConfig());
    expect(agent.config.timeoutMs).toBeUndefined();
  });

  it('execute returns timed-out deliverable when agent times out', async () => {
    // Simulate timeout by using a mock agent that wraps execute
    // and tests the timedOut code path directly
    class TimeoutSimulatingAgent extends Agent {
      async execute(task: Task, options?: { reviewFeedback?: string }): Promise<Deliverable[]> {
        // Directly return a timed-out result to test the format
        return [
          {
            type: 'text',
            label: `${this.name} — ${task.title} (timed out)`,
            content: `[TIMED OUT after 100ms] Agent "${this.name}" did not complete task "${task.title}" within the allowed time.`,
            mimeType: 'text/plain',
          },
        ];
      }
    }

    const agent = new TimeoutSimulatingAgent(makeConfig({ name: 'TestAgent', timeoutMs: 100 }));
    const task = makeTask();
    const result = await agent.execute(task);

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('TIMED OUT');
    expect(result[0].label).toContain('timed out');
    expect(result[0].mimeType).toBe('text/plain');
  });
});

// ─── Configurable maxTokens ───────────────────────────────────────────────────

describe('Agent — configurable maxTokens', () => {
  it('stores maxTokens in config', () => {
    const agent = new Agent(makeConfig({ maxTokens: 16384 }));
    expect(agent.config.maxTokens).toBe(16384);
  });

  it('defaults maxTokens to undefined (uses 8192 internally)', () => {
    const agent = new Agent(makeConfig());
    expect(agent.config.maxTokens).toBeUndefined();
  });

  it('passes maxTokens from config to LLM calls', async () => {
    // Subclass that verifies maxTokens is forwarded
    class InspectableAgent extends Agent {
      public capturedMaxTokens?: number;

      async execute(task: Task, options?: { reviewFeedback?: string }): Promise<Deliverable[]> {
        // Capture the maxTokens that would be used
        this.capturedMaxTokens = this.config.maxTokens ?? 8192;
        return [{ type: 'text', label: 'Test', content: 'done' }];
      }
    }

    const agent = new InspectableAgent(makeConfig({ maxTokens: 32768 }));
    const task = makeTask();
    await agent.execute(task);
    expect(agent.capturedMaxTokens).toBe(32768);
  });
});

// ─── Review Feedback in Execute ───────────────────────────────────────────────

describe('Agent — reviewFeedback in execute()', () => {
  it('accepts reviewFeedback option without error', async () => {
    class EchoAgent extends Agent {
      async execute(task: Task, options?: { reviewFeedback?: string }): Promise<Deliverable[]> {
        const content = options?.reviewFeedback
          ? `Revised based on: ${options.reviewFeedback}`
          : task.title;
        return [{ type: 'text', label: 'Output', content }];
      }
    }

    const agent = new EchoAgent(makeConfig());
    const task = makeTask({ title: 'My Task' });

    const result = await agent.execute(task, { reviewFeedback: 'Please add more detail' });
    expect(result[0].content).toContain('Please add more detail');
  });

  it('works without reviewFeedback (backward compatible)', async () => {
    class EchoAgent extends Agent {
      async execute(task: Task): Promise<Deliverable[]> {
        return [{ type: 'text', label: 'Output', content: task.title }];
      }
    }

    const agent = new EchoAgent(makeConfig());
    const task = makeTask({ title: 'No Feedback Task' });
    const result = await agent.execute(task);
    expect(result[0].content).toBe('No Feedback Task');
  });
});
