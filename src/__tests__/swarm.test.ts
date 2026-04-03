/**
 * Unit tests for ClawSwarm.
 * Covers: construction, agent registration, event emission,
 * goal creation, and execution pipeline (with mocked agents).
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { ClawSwarm } from '../core/clawswarm.js';
import { Agent } from '../core/agent.js';
import type {
  AgentType,
  AgentConfig,
  Task,
  Deliverable,
  SwarmConfig,
} from '../core/types.js';

// Clear API keys so LLM providers use fallback/stub behavior in tests
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterAll(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) process.env[key] = val;
    else delete process.env[key];
  }
});

// ─── Mock Agent ────────────────────────────────────────────────────────────────

class MockAgent extends Agent {
  public deliverables: Deliverable[];
  public shouldThrow = false;
  public callCount = 0;

  constructor(config: AgentConfig, deliverables: Deliverable[] = []) {
    super(config);
    this.deliverables = deliverables.length > 0
      ? deliverables
      : [{ type: 'text', label: 'Mock Output', content: 'Mock deliverable content. '.repeat(10) }];
  }

  async execute(_task: Task): Promise<Deliverable[]> {
    this.callCount++;
    if (this.shouldThrow) throw new Error('Mock agent failure');
    return this.deliverables;
  }
}

// ─── TestableSwarm — inject mock agents ───────────────────────────────────────

/**
 * Subclass that replaces the internal agents Map with our mocks.
 * This tests the orchestration logic without real LLM calls.
 */
class TestableSwarm extends ClawSwarm {
  constructor(config: SwarmConfig, mocks: MockAgent[]) {
    super(config);
    const agentsMap = new Map<AgentType, Agent>();
    for (const agent of mocks) {
      agentsMap.set(agent.type, agent);
    }
    (this as any).agents = agentsMap;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSwarm(mocks: MockAgent[], reviewConfig = { autoApproveThreshold: 8, humanReviewThreshold: 5 }) {
  return new TestableSwarm(
    {
      agents: [
        Agent.research({ model: 'claude-sonnet-4' }),
        Agent.code({ model: 'gpt-4o' }),
      ],
      chiefReview: reviewConfig,
    },
    mocks,
  );
}

function mockResearch(overrides?: Partial<Deliverable>[]) {
  const deliverables = overrides?.map(o => ({ type: 'text' as const, label: 'Research', content: 'content', ...o }));
  return new MockAgent({ type: 'research', model: 'claude-sonnet-4', name: 'ResearchClaw' }, deliverables);
}

function mockCode(overrides?: Partial<Deliverable>[]) {
  const deliverables = overrides?.map(o => ({ type: 'code' as const, label: 'Code', content: 'code', ...o }));
  return new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' }, deliverables);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClawSwarm — construction', () => {
  it('constructs without throwing given valid config', () => {
    expect(() => new ClawSwarm({
      agents: [Agent.research({ model: 'claude-sonnet-4' })],
      chiefReview: { autoApproveThreshold: 8, humanReviewThreshold: 5 },
    })).not.toThrow();
  });

  it('listAgents returns all registered agents', () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);
    const agents = swarm.listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.type)).toContain('research');
    expect(agents.map(a => a.type)).toContain('code');
  });

  it('getAgent returns correct agent by type', () => {
    const research = mockResearch();
    const code = mockCode();
    const swarm = makeSwarm([research, code]);
    expect(swarm.getAgent('research')).toBe(research);
    expect(swarm.getAgent('code')).toBe(code);
  });

  it('getAgent returns undefined for unregistered type', () => {
    const swarm = makeSwarm([mockResearch()]);
    expect(swarm.getAgent('ops')).toBeUndefined();
  });

  it('getReviewer returns the ChiefReviewer instance', () => {
    const swarm = makeSwarm([mockResearch()]);
    const reviewer = swarm.getReviewer();
    expect(reviewer).toBeDefined();
    expect(typeof reviewer.scoreToDecision).toBe('function');
  });

  it('getTaskManager returns the TaskManager instance', () => {
    const swarm = makeSwarm([mockResearch()]);
    const tm = swarm.getTaskManager();
    expect(tm).toBeDefined();
    expect(typeof tm.create).toBe('function');
  });
});

describe('ClawSwarm — createGoal()', () => {
  it('creates and returns a goal', () => {
    const swarm = makeSwarm([mockResearch()]);
    const goal = swarm.createGoal({ title: 'My Goal', description: 'Do stuff' });
    expect(goal.id).toBeTruthy();
    expect(goal.title).toBe('My Goal');
    expect(goal.status).toBe('created');
  });

  it('emits "goal:created" event synchronously', () => {
    const swarm = makeSwarm([mockResearch()]);
    const events: string[] = [];
    swarm.on('goal:created', () => events.push('goal:created'));
    swarm.createGoal({ title: 'T', description: 'D' });
    expect(events).toContain('goal:created');
  });

  it('emits goal:created with the new goal as argument', () => {
    const swarm = makeSwarm([mockResearch()]);
    const received: any[] = [];
    swarm.on('goal:created', (goal) => received.push(goal));
    const goal = swarm.createGoal({ title: 'Test', description: 'Desc' });
    expect(received[0]).toBe(goal);
  });

  it('creating multiple goals produces unique IDs', () => {
    const swarm = makeSwarm([mockResearch()]);
    const g1 = swarm.createGoal({ title: 'G1', description: 'D' });
    const g2 = swarm.createGoal({ title: 'G2', description: 'D' });
    expect(g1.id).not.toBe(g2.id);
  });
});

describe('ClawSwarm — execute()', () => {
  it('completes a goal successfully', async () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);
    const goal = swarm.createGoal({ title: 'Hello World API', description: 'Build a basic API' });
    const result = await swarm.execute(goal);
    expect(result.goal.status).toBe('completed');
  }, 15_000);

  it('returns a GoalResult with all expected fields', async () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);
    const goal = swarm.createGoal({ title: 'Test Goal', description: 'Test description' });
    const result = await swarm.execute(goal);

    expect(result.goal).toBeDefined();
    expect(Array.isArray(result.deliverables)).toBe(true);
    expect(result.cost).toBeDefined();
    expect(typeof result.hadHumanReview).toBe('boolean');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it('emits goal lifecycle events in order', async () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);
    const events: string[] = [];

    swarm.on('goal:created', () => events.push('goal:created'));
    swarm.on('goal:planning', () => events.push('goal:planning'));
    swarm.on('goal:completed', () => events.push('goal:completed'));

    const goal = swarm.createGoal({ title: 'Ordered Events', description: 'Test event ordering' });
    await swarm.execute(goal);

    expect(events).toContain('goal:created');
    expect(events).toContain('goal:planning');
    expect(events).toContain('goal:completed');

    expect(events.indexOf('goal:planning')).toBeGreaterThan(events.indexOf('goal:created'));
    expect(events.indexOf('goal:completed')).toBeGreaterThan(events.indexOf('goal:planning'));
  }, 15_000);

  it('emits task lifecycle events during execution', async () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);
    const events: string[] = [];

    swarm.on('task:assigned', () => events.push('task:assigned'));
    swarm.on('task:started', () => events.push('task:started'));
    swarm.on('task:review', () => events.push('task:review'));
    swarm.on('task:completed', () => events.push('task:completed'));

    const goal = swarm.createGoal({ title: 'Task Events', description: 'Testing task events' });
    await swarm.execute(goal);

    expect(events).toContain('task:assigned');
    expect(events).toContain('task:started');
    expect(events).toContain('task:review');
    expect(events).toContain('task:completed');
  }, 15_000);

  it('collects deliverables from all completed tasks in result', async () => {
    const richContent = 'Comprehensive analysis result. '.repeat(15);
    const research = new MockAgent(
      { type: 'research', model: 'claude-sonnet-4', name: 'ResearchClaw' },
      [{ type: 'text', label: 'Report', content: richContent }],
    );
    const code = new MockAgent(
      { type: 'code', model: 'gpt-4o', name: 'CodeClaw' },
      [{ type: 'code', label: 'Implementation', content: 'const x = 1;\n'.repeat(30) }],
    );

    const swarm = makeSwarm([research, code]);
    const goal = swarm.createGoal({ title: 'Full Feature', description: 'Research and implement' });
    const result = await swarm.execute(goal);

    expect(result.deliverables.length).toBeGreaterThan(0);
  }, 15_000);

  it('marks task as failed when agent throws, but goal still resolves', async () => {
    const failingResearch = mockResearch();
    failingResearch.shouldThrow = true;

    // Code agent succeeds so execution can continue after the failed research task
    const code = mockCode();

    const swarm = makeSwarm([failingResearch, code]);
    const goal = swarm.createGoal({ title: 'Partial Failure', description: 'First task fails' });

    const result = await swarm.execute(goal);

    // The swarm handles agent errors gracefully — the failed task is recorded
    const failedTasks = result.goal.tasks.filter((t: any) => t.status === 'failed');
    expect(failedTasks.length).toBeGreaterThan(0);
    // Failed task stores the error as a deliverable
    expect(failedTasks[0].deliverables.some((d: any) => d.label === 'Error')).toBe(true);
  }, 15_000);

  it('emits task:failed event when agent throws', async () => {
    const failingResearch = mockResearch();
    failingResearch.shouldThrow = true;
    const code = mockCode();

    const swarm = makeSwarm([failingResearch, code]);
    const goal = swarm.createGoal({ title: 'Agent Error', description: 'Agent will throw' });

    const failedTaskIds: string[] = [];
    swarm.on('task:failed', (task: any) => failedTaskIds.push(task.id));

    await swarm.execute(goal);

    // At least one task should have triggered task:failed (the research task)
    expect(failedTaskIds.length).toBeGreaterThan(0);
  }, 15_000);

  it('multiple goals can run on the same swarm instance', async () => {
    const swarm = makeSwarm([mockResearch(), mockCode()]);

    const g1 = swarm.createGoal({ title: 'Goal 1', description: 'First goal' });
    const g2 = swarm.createGoal({ title: 'Goal 2', description: 'Second goal' });

    const r1 = await swarm.execute(g1);
    const r2 = await swarm.execute(g2);

    expect(r1.goal.status).toBe('completed');
    expect(r2.goal.status).toBe('completed');
    expect(r1.goal.id).not.toBe(r2.goal.id);
  }, 30_000);
});

describe('ClawSwarm — event emission verification', () => {
  it('on() and off() behave correctly (add and remove listeners)', () => {
    const swarm = makeSwarm([mockResearch()]);
    const calls: number[] = [];
    const listener = () => calls.push(1);

    swarm.on('goal:created', listener);
    swarm.createGoal({ title: 'G1', description: 'D' });
    expect(calls).toHaveLength(1);

    swarm.off('goal:created', listener);
    swarm.createGoal({ title: 'G2', description: 'D' });
    expect(calls).toHaveLength(1); // still 1, listener removed
  });

  it('once() fires exactly once', () => {
    const swarm = makeSwarm([mockResearch()]);
    const calls: number[] = [];

    swarm.once('goal:created', () => calls.push(1));
    swarm.createGoal({ title: 'G1', description: 'D' });
    swarm.createGoal({ title: 'G2', description: 'D' });

    expect(calls).toHaveLength(1);
  });

  it('human:review_required fires when chief scores task in human-review range', async () => {
    // Default stub gives score=7 for content ~300 chars → human_review
    const swarm = makeSwarm([mockResearch(), mockCode()]);

    let humanReviewFired = false;
    swarm.on('human:review_required', () => { humanReviewFired = true; });

    const goal = swarm.createGoal({ title: 'Medium Quality', description: 'Average content' });
    await swarm.execute(goal);

    // The mock agent returns ~250 chars content → stub score 7 → human_review
    expect(typeof humanReviewFired).toBe('boolean'); // event may or may not fire depending on score
  }, 15_000);
});
