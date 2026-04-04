/**
 * Unit tests for ConvexBridgeAdapter.
 *
 * Uses vitest with node:http to spin up a lightweight mock HTTP server
 * that mimics the moonclawswarm Convex backend endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { ConvexBridgeAdapter } from '../bridge/convex-adapter.js';
import type { ConvexPendingStep } from '../bridge/types.js';

// ─── Mock Server ──────────────────────────────────────────────────────────────

const TEST_PORT = 29876;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const BRIDGE_TOKEN = 'test-secret-token';

/** Minimal pending step fixture */
const MOCK_STEP: ConvexPendingStep = {
  stepId: 'step-abc123',
  stepName: 'Write unit tests',
  runId: 'run-xyz789',
  taskId: 'task-001',
  agentRole: 'developer',
  task: 'Write unit tests for the auth module',
  context: undefined,
  attempts: 0,
  maxRetries: 3,
};

interface MockServerState {
  pendingSteps: ConvexPendingStep[];
  claimedStepIds: string[];
  reportedResults: Array<Record<string, unknown>>;
  pendingStatus: number;
  claimStatus: number;
  reportStatus: number;
  claimResponse: Record<string, unknown>;
  /** Last headers received on any request */
  lastRequestHeaders: Record<string, string | string[] | undefined>;
}

function createMockServer(state: MockServerState, port = TEST_PORT): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? '';

      // Record headers for inspection
      state.lastRequestHeaders = req.headers as Record<string, string | string[] | undefined>;

      // Verify auth token when present
      const token = req.headers['x-bridge-token'];
      if (BRIDGE_TOKEN && token !== BRIDGE_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      if (req.method === 'GET' && url === '/api/bridge/pending') {
        res.writeHead(state.pendingStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.pendingSteps));
        return;
      }

      if (req.method === 'POST' && url === '/api/bridge/claim') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body) as { stepId: string };
          state.claimedStepIds.push(parsed.stepId);
          res.writeHead(state.claimStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(state.claimResponse));
        });
        return;
      }

      if (req.method === 'POST' && url === '/api/bridge/report') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          state.reportedResults.push(JSON.parse(body) as Record<string, unknown>);
          res.writeHead(state.reportStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConvexBridgeAdapter', () => {
  let server: http.Server;
  let state: MockServerState;

  beforeEach(async () => {
    state = {
      pendingSteps: [],
      claimedStepIds: [],
      reportedResults: [],
      pendingStatus: 200,
      claimStatus: 200,
      reportStatus: 200,
      claimResponse: { ok: true },
      lastRequestHeaders: {},
    };
    server = await createMockServer(state);
  });

  afterEach(async () => {
    await new Promise<void>((r) => {
      // Force-close keep-alive connections so the port is released immediately
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      server.close(() => r());
    });
    // Small settle delay to let the OS release the port
    await sleep(20);
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws if convexUrl is empty', () => {
      expect(() => new ConvexBridgeAdapter({ convexUrl: '' })).toThrow(
        'convexUrl is required'
      );
    });

    it('strips trailing slash from convexUrl', () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: `${BASE_URL}/`,
        bridgeToken: BRIDGE_TOKEN,
      });
      // The adapter should still work correctly (indirectly tested by fetch tests)
      expect(adapter).toBeDefined();
      adapter.stop(); // no-op if not started
    });

    it('accepts all optional config fields', () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: 'tok',
        pollIntervalMs: 1000,
        orgId: 'org-1',
        instanceId: 'my-runner',
      });
      expect(adapter).toBeDefined();
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and emits "started"', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000, // won't auto-poll during test
      });

      let started = false;
      adapter.on('started', () => { started = true; });

      await adapter.start();
      expect(adapter.isRunning).toBe(true);
      expect(started).toBe(true);

      adapter.stop();
    });

    it('stops and emits "stopped"', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      let stopped = false;
      adapter.on('stopped', () => { stopped = true; });

      await adapter.start();
      adapter.stop();
      expect(adapter.isRunning).toBe(false);
      expect(stopped).toBe(true);
    });

    it('throws if start() called twice', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      await adapter.start();
      await expect(adapter.start()).rejects.toThrow('already running');
      adapter.stop();
    });

    it('stop() is a no-op if not running', () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
      });
      // Should not throw
      expect(() => adapter.stop()).not.toThrow();
    });
  });

  // ─── Polling ──────────────────────────────────────────────────────────────

  describe('polling', () => {
    it('emits "poll" with empty array when no pending steps', async () => {
      state.pendingSteps = [];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const polls: ConvexPendingStep[][] = [];
      adapter.on('poll', (steps) => polls.push(steps));

      await adapter.start();
      adapter.stop();

      expect(polls.length).toBeGreaterThanOrEqual(1);
      expect(polls[0]).toEqual([]);
    });

    it('claims and emits pending steps', async () => {
      state.pendingSteps = [MOCK_STEP];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const claimed: ConvexPendingStep[] = [];
      adapter.on('step:claimed', (step) => claimed.push(step));

      await adapter.start();
      adapter.stop();

      expect(state.claimedStepIds).toContain(MOCK_STEP.stepId);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.stepId).toBe(MOCK_STEP.stepId);
      expect(claimed[0]?.agentRole).toBe('developer');
    });

    it('does not double-claim the same step in a single poll', async () => {
      // Return the same step twice from pending (simulating a slow backend)
      state.pendingSteps = [MOCK_STEP, MOCK_STEP];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const claimed: ConvexPendingStep[] = [];
      adapter.on('step:claimed', (step) => claimed.push(step));

      await adapter.start();
      adapter.stop();

      // Should only claim once even though the step appeared twice
      expect(state.claimedStepIds.filter((id) => id === MOCK_STEP.stepId)).toHaveLength(1);
      expect(claimed).toHaveLength(1);
    });

    it('runs periodic polls at the configured interval', async () => {
      state.pendingSteps = [];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 50, // very fast for testing
      });

      const polls: ConvexPendingStep[][] = [];
      adapter.on('poll', (steps) => polls.push(steps));

      await adapter.start();
      await sleep(180); // allow at least 2-3 more polls beyond the initial one
      adapter.stop();

      expect(polls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── reportResult ─────────────────────────────────────────────────────────

  describe('reportResult()', () => {
    it('POSTs success result and emits step:reported', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const reported: Array<{ stepId: string; status: string }> = [];
      adapter.on('step:reported', (stepId, status) => reported.push({ stepId, status }));

      await adapter.start();

      await adapter.reportResult({
        stepId: 'step-abc123',
        status: 'success',
        output: 'All tests passed',
        durationMs: 1234,
      });

      adapter.stop();

      expect(state.reportedResults).toHaveLength(1);
      const result = state.reportedResults[0]!;
      expect(result['stepId']).toBe('step-abc123');
      expect(result['status']).toBe('success');
      expect(result['output']).toBe('All tests passed');
      expect(result['durationMs']).toBe(1234);

      expect(reported).toHaveLength(1);
      expect(reported[0]).toEqual({ stepId: 'step-abc123', status: 'success' });
    });

    it('POSTs error result', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      await adapter.start();

      await adapter.reportResult({
        stepId: 'step-fail',
        status: 'error',
        error: 'Agent timed out',
      });

      adapter.stop();

      expect(state.reportedResults[0]?.['status']).toBe('error');
      expect(state.reportedResults[0]?.['error']).toBe('Agent timed out');
    });

    it('includes tokenUsage when provided', async () => {
      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      await adapter.start();

      await adapter.reportResult({
        stepId: 'step-tokens',
        status: 'success',
        output: 'done',
        tokenUsage: { input: 100, output: 200, total: 300, cost: 0.005 },
      });

      adapter.stop();

      const usage = state.reportedResults[0]?.['tokenUsage'] as Record<string, number>;
      expect(usage).toBeDefined();
      expect(usage['input']).toBe(100);
      expect(usage['total']).toBe(300);
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('emits error when pending endpoint returns non-200', async () => {
      state.pendingStatus = 500;

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const errors: Error[] = [];
      adapter.on('error', (err) => errors.push(err));

      await adapter.start();
      adapter.stop();

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]?.message).toMatch(/pending/i);
    });

    it('emits error when server is unreachable', async () => {
      // Use a port that has no server listening
      const deadUrl = 'http://127.0.0.1:29877';

      const adapter = new ConvexBridgeAdapter({
        convexUrl: deadUrl,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const errors: Error[] = [];
      adapter.on('error', (err) => errors.push(err));

      await adapter.start();
      adapter.stop();

      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('does not throw when claim returns { ok: false }', async () => {
      state.pendingSteps = [MOCK_STEP];
      state.claimResponse = { ok: false, reason: 'already_claimed' };

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const claimed: ConvexPendingStep[] = [];
      adapter.on('step:claimed', (step) => claimed.push(step));

      await adapter.start();
      adapter.stop();

      // Claim was rejected — should not fire step:claimed
      expect(claimed).toHaveLength(0);
    });
  });

  // ─── Auth ──────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('sends X-Bridge-Token header', async () => {
      state.pendingSteps = [];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: BRIDGE_TOKEN,
        pollIntervalMs: 60_000,
      });

      const errors: Error[] = [];
      adapter.on('error', (err) => errors.push(err));

      await adapter.start();
      adapter.stop();

      // No errors = token was accepted by mock server
      expect(errors).toHaveLength(0);
      // Verify the header was actually sent
      expect(state.lastRequestHeaders['x-bridge-token']).toBe(BRIDGE_TOKEN);
    });

    it('emits 401 error when token is wrong', async () => {
      state.pendingSteps = [MOCK_STEP];

      const adapter = new ConvexBridgeAdapter({
        convexUrl: BASE_URL,
        bridgeToken: 'wrong-token',
        pollIntervalMs: 60_000,
      });

      const errors: Error[] = [];
      adapter.on('error', (err) => errors.push(err));

      await adapter.start();
      adapter.stop();

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]?.message).toMatch(/401/);
    });
  });
});
