/**
 * Unit tests for DashboardBridge.
 *
 * All HTTP calls are mocked via globalThis.fetch so no real network is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardBridge } from '../bridge/dashboard-bridge.js';
import { ClawSwarm } from '../core/clawswarm.js';
import type { Goal, Task, ReviewResult } from '../core/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-test-1',
    title: 'Test Goal',
    description: 'A test goal',
    status: 'created',
    tasks: [],
    deliverables: [],
    cost: { totalTokens: 0, estimatedCostUsd: 0, byAgent: {} },
    createdAt: new Date().toISOString(),
    priority: 1,
    tags: [],
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-test-1',
    goalId: 'goal-test-1',
    title: 'Test Task',
    description: 'A test task',
    status: 'pending',
    deliverables: [],
    reworkCount: 0,
    maxReworkCycles: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependsOn: [],
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    taskId: 'task-test-1',
    score: 9,
    decision: 'approved',
    feedback: 'Looks great',
    issues: [],
    suggestions: [],
    reviewedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFetchMock(responses: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    // Default response shape based on endpoint
    const path = new URL(url).pathname;
    const body = responses[path] ?? {};
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardBridge', () => {
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    fetchMock = makeFetchMock({
      '/api/bridge/create-goal': { goalId: 'dash-goal-1' },
      '/api/bridge/create-board': { boardId: 'dash-board-1' },
      '/api/bridge/create-task': { taskId: 'dash-task-1' },
      '/api/bridge/update-goal': { ok: true },
      '/api/bridge/agent-start': { ok: true },
      '/api/bridge/report': { ok: true },
      '/api/bridge/chief-review': { ok: true },
      '/api/bridge/stream-events': { ok: true },
      '/api/bridge/cost-event': { ok: true },
      '/api/bridge/escalate-to-human': { ok: true },
    });
    // @ts-expect-error — mocking global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('throws if convexSiteUrl is missing', () => {
    expect(() => new DashboardBridge({ convexSiteUrl: '' })).toThrow(
      'DashboardBridge: convexSiteUrl is required',
    );
  });

  it('strips trailing slash from convexSiteUrl', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://example.convex.site/',
      streamIntervalMs: 999999,
    });

    const goal = makeGoal();
    // Manually trigger via mock swarm event
    const swarm = new ClawSwarm({
      agents: [{ type: 'code', model: 'gpt-4o' }],
    });
    bridge.attach(swarm);
    swarm.emit('goal:created', goal);

    await new Promise(r => setTimeout(r, 50));
    bridge.detach();

    const calledUrls = fetchMock.mock.calls.map(c => c[0] as string);
    // URL should not contain double-slash before /api
    expect(calledUrls.some(u => u.includes('//api/'))).toBe(false);
    expect(calledUrls.some(u => u.includes('example.convex.site/api/'))).toBe(true);
  });

  // ── Attach / Detach ───────────────────────────────────────────────────────

  it('attaches and detaches without throwing', () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    expect(() => bridge.attach(swarm)).not.toThrow();
    expect(() => bridge.detach()).not.toThrow();
  });

  it('is idempotent when attached twice to same swarm', () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);
    bridge.attach(swarm); // second attach — should be no-op
    bridge.detach();
    // No listener duplicates means event fired once
    swarm.emit('goal:created', makeGoal());
    expect(fetchMock).not.toHaveBeenCalled(); // detached, no calls
  });

  // ── goal:created ──────────────────────────────────────────────────────────

  it('posts create-goal when goal:created fires', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      bridgeToken: 'tok-123',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    const goal = makeGoal();
    swarm.emit('goal:created', goal);
    await new Promise(r => setTimeout(r, 50));

    const createGoalCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/create-goal'),
    );
    expect(createGoalCall).toBeDefined();

    const init = createGoalCall![1] as RequestInit;
    expect(init.headers).toMatchObject({ 'X-Bridge-Token': 'tok-123' });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['name']).toBe('Test Goal');
    expect(body['status']).toBe('active');

    bridge.detach();
  });

  it('maps OSS goal ID to dashboard goal ID after create-goal', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    const goal = makeGoal();
    swarm.emit('goal:created', goal);
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.getDashboardGoalId('goal-test-1')).toBe('dash-goal-1');
    bridge.detach();
  });

  it('creates a board after creating the goal', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));

    const boardCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/create-board'),
    );
    expect(boardCall).toBeDefined();
    const body = JSON.parse((boardCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['goalId']).toBe('dash-goal-1');

    bridge.detach();
  });

  // ── goal:planning / goal:completed / goal:failed ──────────────────────────

  it('posts update-goal with status active on goal:planning', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    // Set up mapping
    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('goal:planning', makeGoal({ status: 'planning' }));
    await new Promise(r => setTimeout(r, 50));

    const updateCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/update-goal'),
    );
    expect(updateCall).toBeDefined();
    const body = JSON.parse((updateCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['goalId']).toBe('dash-goal-1');
    expect(body['status']).toBe('active');

    bridge.detach();
  });

  it('posts update-goal with status achieved on goal:completed', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('goal:completed', makeGoal({ status: 'completed' }));
    await new Promise(r => setTimeout(r, 50));

    const updateCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/update-goal'),
    );
    expect(updateCall).toBeDefined();
    const body = JSON.parse((updateCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['status']).toBe('achieved');

    bridge.detach();
  });

  it('posts update-goal with status failed on goal:failed', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('goal:failed', makeGoal({ status: 'failed' }), new Error('oops'));
    await new Promise(r => setTimeout(r, 50));

    const updateCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/update-goal'),
    );
    expect(updateCall).toBeDefined();
    const body = JSON.parse((updateCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['status']).toBe('failed');

    bridge.detach();
  });

  // ── task:assigned ─────────────────────────────────────────────────────────

  it('posts create-task when task:assigned fires (after goal setup)', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));

    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));

    const createTaskCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/create-task'),
    );
    expect(createTaskCall).toBeDefined();
    const body = JSON.parse((createTaskCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['title']).toBe('Test Task');
    expect(body['boardId']).toBe('dash-board-1');
    expect(body['goalId']).toBe('dash-goal-1');

    bridge.detach();
  });

  it('maps OSS task ID to dashboard task ID after create-task', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.getDashboardTaskId('task-test-1')).toBe('dash-task-1');
    bridge.detach();
  });

  // ── task:started ──────────────────────────────────────────────────────────

  it('posts agent-start when task:started fires', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('task:started', makeTask({ status: 'in_progress', assignedTo: 'code' }));
    await new Promise(r => setTimeout(r, 50));

    const startCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/agent-start'),
    );
    expect(startCall).toBeDefined();
    const body = JSON.parse((startCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['taskId']).toBe('dash-task-1');
    expect(body['role']).toBe('code');

    bridge.detach();
  });

  // ── task:completed ────────────────────────────────────────────────────────

  it('posts report on task:completed', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('task:completed', makeTask({
      status: 'completed',
      deliverables: [{ type: 'text', label: 'Output', content: 'Done!' }],
    }));
    await new Promise(r => setTimeout(r, 50));

    const reportCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/report'),
    );
    expect(reportCall).toBeDefined();
    const body = JSON.parse((reportCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['stepId']).toBe('dash-task-1');
    expect(body['status']).toBe('success');

    bridge.detach();
  });

  // ── task:review ───────────────────────────────────────────────────────────

  it('posts chief-review on task:review', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    const review = makeReview({ score: 9, decision: 'approved', feedback: 'Great job!' });
    swarm.emit('task:review', makeTask({ status: 'review' }), review);
    await new Promise(r => setTimeout(r, 50));

    const reviewCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/chief-review'),
    );
    expect(reviewCall).toBeDefined();
    const body = JSON.parse((reviewCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['taskId']).toBe('dash-task-1');
    expect(body['decision']).toBe('approved');
    expect(body['qualityScore']).toBe(9);

    bridge.detach();
  });

  // ── task:failed ───────────────────────────────────────────────────────────

  it('posts report with error status on task:failed', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    swarm.emit('task:failed', makeTask({ status: 'failed' }), new Error('LLM timeout'));
    await new Promise(r => setTimeout(r, 50));

    const reportCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/report'),
    );
    expect(reportCall).toBeDefined();
    const body = JSON.parse((reportCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['status']).toBe('error');
    expect(body['error']).toBe('LLM timeout');

    bridge.detach();
  });

  // ── human:review_required ─────────────────────────────────────────────────

  it('posts escalate-to-human on human:review_required', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));
    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));
    fetchMock.mockClear();

    const review = makeReview({ score: 4, decision: 'human_review', feedback: 'Needs human eye' });
    swarm.emit('human:review_required', makeTask({ status: 'review' }), review);
    await new Promise(r => setTimeout(r, 50));

    const escalateCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/escalate-to-human'),
    );
    expect(escalateCall).toBeDefined();
    const body = JSON.parse((escalateCall![1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['taskId']).toBe('dash-task-1');
    expect(body['chiefScore']).toBe(4);
    expect(body['chiefFeedback']).toBe('Needs human eye');

    bridge.detach();
  });

  // ── stream events ─────────────────────────────────────────────────────────

  it('flushes stream events on detach', async () => {
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999, // disable timer flush
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('goal:created', makeGoal());
    await new Promise(r => setTimeout(r, 50));

    fetchMock.mockClear();
    bridge.detach(); // should flush stream events
    await new Promise(r => setTimeout(r, 50));

    const streamCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/stream-events'),
    );
    expect(streamCall).toBeDefined();
  });

  // ── resilience ────────────────────────────────────────────────────────────

  it('does not throw if dashboard is unreachable (fetch rejects)', async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    // @ts-expect-error — mocking global fetch
    globalThis.fetch = failFetch;

    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    await expect(async () => {
      swarm.emit('goal:created', makeGoal());
      await new Promise(r => setTimeout(r, 50));
    }).not.toThrow();

    bridge.detach();
  });

  it('does not post to task endpoints if goal was not synced', async () => {
    // No create-goal event fired — goal/board IDs not known
    const bridge = new DashboardBridge({
      convexSiteUrl: 'https://x.convex.site',
      streamIntervalMs: 999999,
    });
    const swarm = new ClawSwarm({ agents: [{ type: 'code', model: 'gpt-4o' }] });
    bridge.attach(swarm);

    swarm.emit('task:assigned', makeTask(), 'code');
    await new Promise(r => setTimeout(r, 50));

    const createTaskCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).includes('/api/bridge/create-task'),
    );
    // Should NOT create task if no goal mapping exists
    expect(createTaskCall).toBeUndefined();

    bridge.detach();
  });
});
