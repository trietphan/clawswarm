/**
 * Unit tests for DashboardReporter.
 *
 * All HTTP calls are mocked via globalThis.fetch so no real network is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DashboardReporter } from '../dashboard-reporter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFetchMock(status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => ({ ok: true }),
    text: async () => '{"ok":true}',
  });
}

/** Read the last JSON body sent to fetch mock */
function lastBody(fetchMock: ReturnType<typeof makeFetchMock>): Record<string, unknown> {
  const calls = fetchMock.mock.calls;
  const last = calls[calls.length - 1];
  return JSON.parse(last![1].body as string) as Record<string, unknown>;
}

/** Read the last URL sent to fetch mock */
function lastUrl(fetchMock: ReturnType<typeof makeFetchMock>): string {
  const calls = fetchMock.mock.calls;
  return calls[calls.length - 1]![0] as string;
}

/** Read the last headers sent to fetch mock */
function lastHeaders(fetchMock: ReturnType<typeof makeFetchMock>): Record<string, string> {
  const calls = fetchMock.mock.calls;
  return calls[calls.length - 1]![1].headers as Record<string, string>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardReporter', () => {
  let fetchMock: ReturnType<typeof makeFetchMock>;

  beforeEach(() => {
    fetchMock = makeFetchMock();
    // @ts-expect-error — mocking global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['CLAWSWARM_API_KEY'];
    delete process.env['CLAWSWARM_DASHBOARD_URL'];
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('is disabled when no apiKey is provided', () => {
    const reporter = new DashboardReporter({});
    expect(reporter.isEnabled).toBe(false);
  });

  it('is enabled when apiKey is provided', () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test-key' });
    expect(reporter.isEnabled).toBe(true);
  });

  it('creates from env vars', () => {
    process.env['CLAWSWARM_API_KEY'] = 'cs-env-key';
    process.env['CLAWSWARM_DASHBOARD_URL'] = 'https://my.dashboard.app';
    const reporter = DashboardReporter.fromEnv();
    expect(reporter.isEnabled).toBe(true);
  });

  it('fromEnv is disabled when CLAWSWARM_API_KEY is not set', () => {
    delete process.env['CLAWSWARM_API_KEY'];
    const reporter = DashboardReporter.fromEnv();
    expect(reporter.isEnabled).toBe(false);
  });

  // ── Opt-in behavior ───────────────────────────────────────────────────────

  it('does NOT call fetch when disabled (no apiKey)', async () => {
    const reporter = new DashboardReporter({});
    reporter.runStarted({ runId: 'r1', goal: 'Do something' });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls fetch when enabled', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test-key' });
    reporter.runStarted({ runId: 'r1', goal: 'Do something' });
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Endpoint URL ──────────────────────────────────────────────────────────

  it('posts to /api/bridge/events on default dashboard URL', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));
    expect(lastUrl(fetchMock)).toBe('https://clawswarm.app/api/bridge/events');
  });

  it('posts to custom dashboardUrl', async () => {
    const reporter = new DashboardReporter({
      apiKey: 'cs-test',
      dashboardUrl: 'https://staging.clawswarm.app',
    });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));
    expect(lastUrl(fetchMock)).toBe('https://staging.clawswarm.app/api/bridge/events');
  });

  it('strips trailing slash from dashboardUrl', async () => {
    const reporter = new DashboardReporter({
      apiKey: 'cs-test',
      dashboardUrl: 'https://clawswarm.app/',
    });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));
    expect(lastUrl(fetchMock)).toBe('https://clawswarm.app/api/bridge/events');
    expect(lastUrl(fetchMock)).not.toContain('//api');
  });

  // ── Authorization header ──────────────────────────────────────────────────

  it('sends Authorization: Bearer <apiKey> header', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-my-key-123' });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));
    expect(lastHeaders(fetchMock)['Authorization']).toBe('Bearer cs-my-key-123');
  });

  it('sends Content-Type: application/json header', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));
    expect(lastHeaders(fetchMock)['Content-Type']).toBe('application/json');
  });

  // ── Event: run.started ────────────────────────────────────────────────────

  it('sends run.started event with correct shape', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runStarted({ runId: 'run-abc', goal: 'Write tests', metadata: { version: '1.0' } });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('run.started');
    expect(body['runId']).toBe('run-abc');
    expect(body['timestamp']).toBeDefined();
    const data = body['data'] as Record<string, unknown>;
    expect(data['goal']).toBe('Write tests');
    expect(data['version']).toBe('1.0');
  });

  // ── Event: run.completed ──────────────────────────────────────────────────

  it('sends run.completed event', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runCompleted({ runId: 'run-abc', summary: 'All done', durationMs: 1500 });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('run.completed');
    expect(body['runId']).toBe('run-abc');
    const data = body['data'] as Record<string, unknown>;
    expect(data['summary']).toBe('All done');
    expect(data['durationMs']).toBe(1500);
  });

  it('includes error in run.completed when run failed', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runCompleted({ runId: 'run-xyz', error: 'LLM timeout' });
    await new Promise(r => setTimeout(r, 20));

    const data = (lastBody(fetchMock)['data']) as Record<string, unknown>;
    expect(data['error']).toBe('LLM timeout');
  });

  // ── Event: task.created ───────────────────────────────────────────────────

  it('sends task.created event', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.taskCreated({
      runId: 'run-1',
      taskId: 'task-1',
      title: 'Research best practices',
      agentRole: 'researcher',
    });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('task.created');
    expect(body['runId']).toBe('run-1');
    expect(body['taskId']).toBe('task-1');
    const data = body['data'] as Record<string, unknown>;
    expect(data['title']).toBe('Research best practices');
    expect(data['agentRole']).toBe('researcher');
  });

  // ── Event: task.completed ─────────────────────────────────────────────────

  it('sends task.completed event', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.taskCompleted({ runId: 'run-1', taskId: 'task-1', output: 'Task output here' });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('task.completed');
    expect(body['taskId']).toBe('task-1');
    const data = body['data'] as Record<string, unknown>;
    expect(data['output']).toBe('Task output here');
  });

  // ── Event: step.started ───────────────────────────────────────────────────

  it('sends step.started event', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.stepStarted({
      runId: 'run-1',
      stepId: 'step-1',
      taskId: 'task-1',
      agentRole: 'code',
    });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('step.started');
    expect(body['runId']).toBe('run-1');
    expect(body['stepId']).toBe('step-1');
    expect(body['taskId']).toBe('task-1');
    const data = body['data'] as Record<string, unknown>;
    expect(data['agentRole']).toBe('code');
  });

  // ── Event: step.completed ─────────────────────────────────────────────────

  it('sends step.completed event with token usage', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.stepCompleted({
      runId: 'run-1',
      stepId: 'step-1',
      output: 'Step output',
      durationMs: 3200,
      tokenUsage: { input: 100, output: 200, total: 300 },
    });
    await new Promise(r => setTimeout(r, 20));

    const body = lastBody(fetchMock);
    expect(body['type']).toBe('step.completed');
    const data = body['data'] as Record<string, unknown>;
    expect(data['durationMs']).toBe(3200);
    const tokens = data['tokenUsage'] as Record<string, unknown>;
    expect(tokens['total']).toBe(300);
  });

  // ── Event payload structure ───────────────────────────────────────────────

  it('always includes runId, type, and timestamp in every event', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });

    const calls = [
      () => reporter.runStarted({ runId: 'r1', goal: 'g' }),
      () => reporter.runCompleted({ runId: 'r1' }),
      () => reporter.taskCreated({ runId: 'r1', taskId: 't1', title: 'T' }),
      () => reporter.taskCompleted({ runId: 'r1', taskId: 't1' }),
      () => reporter.stepStarted({ runId: 'r1', stepId: 's1' }),
      () => reporter.stepCompleted({ runId: 'r1', stepId: 's1' }),
    ];

    for (const call of calls) {
      call();
    }
    await new Promise(r => setTimeout(r, 50));

    expect(fetchMock).toHaveBeenCalledTimes(6);

    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body['runId']).toBeDefined();
      expect(body['type']).toBeDefined();
      expect(body['timestamp']).toBeDefined();
      // timestamp must be a valid ISO string
      expect(() => new Date(body['timestamp'] as string)).not.toThrow();
    }
  });

  it('uses HTTP POST method', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
  });

  // ── Resilience ────────────────────────────────────────────────────────────

  it('does not throw when fetch rejects (network error)', async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    // @ts-expect-error — mocking global fetch
    globalThis.fetch = failFetch;

    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    await expect(async () => {
      reporter.runStarted({ runId: 'r1', goal: 'Test' });
      await new Promise(r => setTimeout(r, 50));
    }).not.toThrow();
  });

  it('does not throw when fetch returns non-2xx status', async () => {
    // @ts-expect-error — mocking global fetch
    globalThis.fetch = makeFetchMock(500);

    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    await expect(async () => {
      reporter.runStarted({ runId: 'r1', goal: 'Test' });
      await new Promise(r => setTimeout(r, 50));
    }).not.toThrow();
  });

  it('multiple rapid calls do not throw', async () => {
    const reporter = new DashboardReporter({ apiKey: 'cs-test' });
    await expect(async () => {
      for (let i = 0; i < 20; i++) {
        reporter.runStarted({ runId: `r${i}`, goal: `Goal ${i}` });
      }
      await new Promise(r => setTimeout(r, 100));
    }).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  // ── fromEnv integration ───────────────────────────────────────────────────

  it('fromEnv reads CLAWSWARM_DASHBOARD_URL', async () => {
    process.env['CLAWSWARM_API_KEY'] = 'cs-test-key';
    process.env['CLAWSWARM_DASHBOARD_URL'] = 'https://my-staging.clawswarm.app';

    const reporter = DashboardReporter.fromEnv();
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));

    expect(lastUrl(fetchMock)).toBe('https://my-staging.clawswarm.app/api/bridge/events');
  });

  it('fromEnv defaults to https://clawswarm.app when CLAWSWARM_DASHBOARD_URL not set', async () => {
    process.env['CLAWSWARM_API_KEY'] = 'cs-test-key';
    delete process.env['CLAWSWARM_DASHBOARD_URL'];

    const reporter = DashboardReporter.fromEnv();
    reporter.runStarted({ runId: 'r1', goal: 'Test' });
    await new Promise(r => setTimeout(r, 20));

    expect(lastUrl(fetchMock)).toBe('https://clawswarm.app/api/bridge/events');
  });
});
