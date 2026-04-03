/**
 * Unit tests for the ClawSwarm BridgeServer.
 *
 * Tests cover: connection lifecycle, authentication, message routing,
 * connection limits, graceful shutdown, health endpoint, error handling,
 * and malformed message resilience.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import http from 'node:http';
import { BridgeServer } from '../bridge/bridge.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PORT = 19787;
const HEALTH_PORT = 19788;
const WS_URL = `ws://127.0.0.1:${TEST_PORT}`;
const HEALTH_URL = `http://127.0.0.1:${HEALTH_PORT}/health`;

function createServer(overrides: Record<string, unknown> = {}): BridgeServer {
  return new BridgeServer({
    port: TEST_PORT,
    host: '127.0.0.1',
    healthPort: HEALTH_PORT,
    pingIntervalMs: 60_000, // long interval so it doesn't interfere
    ...overrides,
  } as any);
}

function connect(url = WS_URL): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function httpGet(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode!, body: data });
        }
      });
    }).on('error', reject);
  });
}

// Small delay helper
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BridgeServer', () => {
  let server: BridgeServer;

  afterEach(async () => {
    if (server) {
      await server.stop().catch(() => {});
      // Wait for OS to fully release the ports
      await new Promise((r) => setTimeout(r, 150));
    }
  });

  // ── Connection ──────────────────────────────────────────────────────────

  describe('connection', () => {
    it('accepts a WebSocket connection', async () => {
      server = createServer();
      await server.start();

      const connected = new Promise<void>((resolve) => {
        server.on('client:connected', () => resolve());
      });

      const ws = await connect();
      await connected;

      expect(server.stats().connections).toBe(1);
      ws.close();
    });

    it('emits client:disconnected on close', async () => {
      server = createServer();
      await server.start();

      const disconnected = new Promise<string>((resolve) => {
        server.on('client:disconnected', (id) => resolve(id));
      });

      const ws = await connect();
      await delay(50);
      ws.close();

      const id = await disconnected;
      expect(id).toBeTruthy();
    });

    it('assigns a unique client ID to each connection', async () => {
      server = createServer();
      await server.start();

      const ids: string[] = [];
      server.on('client:connected', (c) => ids.push(c.id));

      const ws1 = await connect();
      const ws2 = await connect();
      await delay(50);

      expect(ids.length).toBe(2);
      expect(ids[0]).not.toBe(ids[1]);

      ws1.close();
      ws2.close();
    });
  });

  // ── Auth ────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('allows connections without auth when no tokens configured', async () => {
      server = createServer({ authTokens: [] });
      await server.start();

      const ws = await connect();
      ws.send(JSON.stringify({ type: 'ping', ts: new Date().toISOString(), payload: {} }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('pong');
      ws.close();
    });

    it('rejects messages before auth when tokens are configured', async () => {
      server = createServer({ authTokens: ['secret-token'] });
      await server.start();

      const ws = await connect();
      ws.send(JSON.stringify({ type: 'ping', ts: new Date().toISOString(), payload: {} }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('error');
      expect(msg.payload.code).toBe('UNAUTHORIZED');
      ws.close();
    });

    it('authenticates with a valid token', async () => {
      server = createServer({ authTokens: ['secret-token'] });
      await server.start();

      const authed = new Promise<void>((resolve) => {
        server.on('client:authenticated', () => resolve());
      });

      const ws = await connect();
      ws.send(JSON.stringify({
        type: 'auth',
        ts: new Date().toISOString(),
        payload: { token: 'secret-token', orgId: 'org-1', role: 'agent' },
      }));

      const ack = await nextMessage(ws);
      expect(ack.payload.authenticated).toBe(true);
      await authed;

      // Now ping should work
      ws.send(JSON.stringify({ type: 'ping', ts: new Date().toISOString(), payload: {} }));
      const pong = await nextMessage(ws);
      expect(pong.type).toBe('pong');

      ws.close();
    });

    it('rejects an invalid token and closes the connection', async () => {
      server = createServer({ authTokens: ['secret-token'] });
      await server.start();

      const ws = await connect();
      const closeP = waitForClose(ws);

      ws.send(JSON.stringify({
        type: 'auth',
        ts: new Date().toISOString(),
        payload: { token: 'wrong-token', orgId: 'org-1', role: 'agent' },
      }));

      const errMsg = await nextMessage(ws);
      expect(errMsg.type).toBe('error');
      expect(errMsg.payload.code).toBe('INVALID_TOKEN');

      const { code } = await closeP;
      expect(code).toBe(1008);
    });

    it('rejects auth with invalid payload shape', async () => {
      server = createServer({ authTokens: ['secret-token'] });
      await server.start();

      const ws = await connect();
      const closeP = waitForClose(ws);

      ws.send(JSON.stringify({
        type: 'auth',
        ts: new Date().toISOString(),
        payload: { /* missing token, orgId, role */ },
      }));

      const errMsg = await nextMessage(ws);
      expect(errMsg.type).toBe('error');
      expect(errMsg.payload.code).toBe('INVALID_AUTH');

      await closeP;
    });
  });

  // ── Message routing ─────────────────────────────────────────────────────

  describe('message routing', () => {
    it('routes messages to authenticated clients in the same org', async () => {
      server = createServer({ authTokens: ['tok'] });
      await server.start();

      // Connect and auth two clients in same org
      const ws1 = await connect();
      ws1.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-a', role: 'dashboard' },
      }));
      await nextMessage(ws1); // auth ack

      const ws2 = await connect();
      ws2.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-a', role: 'agent' },
      }));
      await nextMessage(ws2); // auth ack

      // Broadcast to org-a
      const msgP = nextMessage(ws1);
      const count = server.broadcast('org-a', {
        type: 'task:completed',
        ts: new Date().toISOString(),
        payload: { task: 'test' },
      });

      expect(count).toBe(2);
      const received = await msgP;
      expect(received.type).toBe('task:completed');

      ws1.close();
      ws2.close();
    });

    it('does not route messages across orgs', async () => {
      server = createServer({ authTokens: ['tok'] });
      await server.start();

      const ws1 = await connect();
      ws1.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-a', role: 'dashboard' },
      }));
      await nextMessage(ws1);

      const ws2 = await connect();
      ws2.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-b', role: 'dashboard' },
      }));
      await nextMessage(ws2);

      // Broadcast only to org-b
      const count = server.broadcast('org-b', {
        type: 'task:completed',
        ts: new Date().toISOString(),
        payload: {},
      });
      expect(count).toBe(1);

      ws1.close();
      ws2.close();
    });

    it('filters broadcast by role', async () => {
      server = createServer({ authTokens: ['tok'] });
      await server.start();

      const wsAgent = await connect();
      wsAgent.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-a', role: 'agent' },
      }));
      await nextMessage(wsAgent);

      const wsDash = await connect();
      wsDash.send(JSON.stringify({
        type: 'auth', ts: '', payload: { token: 'tok', orgId: 'org-a', role: 'dashboard' },
      }));
      await nextMessage(wsDash);

      const count = server.broadcast('org-a', {
        type: 'agent:status',
        ts: new Date().toISOString(),
        payload: {},
      }, ['dashboard']);

      expect(count).toBe(1);

      wsAgent.close();
      wsDash.close();
    });
  });

  // ── Connection limits ───────────────────────────────────────────────────

  describe('connection limits', () => {
    it('enforces maxConnections', async () => {
      server = createServer({ maxConnections: 2 });
      await server.start();

      const ws1 = await connect();
      const ws2 = await connect();
      await delay(50);

      expect(server.stats().connections).toBe(2);

      // Third connection should be rejected
      const ws3 = new WebSocket(WS_URL);
      const closeP = new Promise<number>((resolve) => {
        ws3.on('close', (code) => resolve(code));
      });
      const code = await closeP;
      expect(code).toBe(1013);

      ws1.close();
      ws2.close();
    });
  });

  // ── Disconnect cleanup ──────────────────────────────────────────────────

  describe('disconnect cleanup', () => {
    it('removes client from internal map on disconnect', async () => {
      server = createServer();
      await server.start();

      const ws = await connect();
      await delay(50);
      expect(server.stats().connections).toBe(1);

      ws.close();
      await delay(100);
      expect(server.stats().connections).toBe(0);
    });

    it('cleans up after multiple connects and disconnects', async () => {
      server = createServer();
      await server.start();

      const sockets: WebSocket[] = [];
      for (let i = 0; i < 5; i++) {
        sockets.push(await connect());
      }
      await delay(50);
      expect(server.stats().connections).toBe(5);

      for (const ws of sockets) ws.close();
      await delay(200);
      expect(server.stats().connections).toBe(0);
    });
  });

  // ── Health endpoint ─────────────────────────────────────────────────────

  describe('health endpoint', () => {
    it('returns 200 with connection count on GET /health', async () => {
      server = createServer();
      await server.start();
      await delay(100); // let health server start

      const res = await httpGet(HEALTH_URL);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.connections).toBe(0);
      expect(res.body.uptime).toBe(true);
    });

    it('reflects connection count', async () => {
      server = createServer();
      await server.start();
      await delay(100);

      const ws = await connect();
      await delay(50);

      const res = await httpGet(HEALTH_URL);
      expect(res.body.connections).toBe(1);

      ws.close();
    });

    it('returns 404 for unknown paths', async () => {
      server = createServer();
      await server.start();
      await delay(100);

      const res = await httpGet(`http://127.0.0.1:${HEALTH_PORT}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns PARSE_ERROR for invalid JSON', async () => {
      server = createServer();
      await server.start();

      const ws = await connect();
      ws.send('not-json{{{');
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('error');
      expect(msg.payload.code).toBe('PARSE_ERROR');
      ws.close();
    });

    it('returns INVALID_MESSAGE for message without type field', async () => {
      server = createServer();
      await server.start();

      const ws = await connect();
      ws.send(JSON.stringify({ payload: 'hi' }));
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('error');
      expect(msg.payload.code).toBe('INVALID_MESSAGE');
      ws.close();
    });

    it('handles empty string messages gracefully', async () => {
      server = createServer();
      await server.start();

      const ws = await connect();
      ws.send('');
      const msg = await nextMessage(ws);
      expect(msg.type).toBe('error');
      ws.close();
    });

    it('does not crash on rapid connect/disconnect', async () => {
      server = createServer();
      await server.start();

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          connect().then((ws) => {
            ws.close();
          }).catch(() => {})
        );
      }
      await Promise.all(promises);
      await delay(200);

      // Server should still be alive
      const ws = await connect();
      expect(server.stats().uptime).toBe(true);
      ws.close();
    });
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────

  describe('graceful shutdown', () => {
    it('closes all connections on stop()', async () => {
      server = createServer();
      await server.start();

      const ws1 = await connect();
      const ws2 = await connect();
      const close1 = waitForClose(ws1);
      const close2 = waitForClose(ws2);

      await server.stop();

      const r1 = await close1;
      const r2 = await close2;
      expect(r1.code).toBe(1001);
      expect(r2.code).toBe(1001);
    });

    it('stop() is idempotent', async () => {
      server = createServer();
      await server.start();
      await server.stop();
      await server.stop(); // Should not throw
    });

    it('rejects new connections during shutdown', async () => {
      server = createServer();
      await server.start();

      // Start stopping but don't await yet
      const stopP = server.stop();

      // Try to connect during shutdown
      const ws = new WebSocket(WS_URL);
      const closeP = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => resolve(-1));
      });

      await stopP;
      const code = await closeP;
      // Either rejected with 1001 or connection refused (-1)
      expect([1001, -1]).toContain(code);
    });
  });
});
