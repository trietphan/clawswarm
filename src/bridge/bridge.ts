/**
 * WebSocket bridge server for ClawSwarm.
 *
 * Provides real-time bidirectional communication between agents,
 * dashboard clients, and external consumers. Handles org-scoped
 * message routing, authentication, and connection lifecycle.
 *
 * @module @clawswarm/bridge/bridge
 */

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import {
  BridgeClient,
  BridgeMessage,
  BridgeServerConfig,
  BridgeServerEvents,
  AuthPayload,
} from './types.js';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_MAX_CONNECTIONS = 1000;
const DEFAULT_PING_INTERVAL_MS = 30_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;

// ─── Environment-driven config helpers ────────────────────────────────────────

/**
 * Build a BridgeServerConfig by merging explicit values with environment
 * variables.  Env vars use the `BRIDGE_` prefix:
 *
 *   BRIDGE_PORT, BRIDGE_HOST, BRIDGE_MAX_CONNECTIONS, BRIDGE_PING_INTERVAL_MS,
 *   BRIDGE_AUTH_TOKENS (comma-separated), BRIDGE_PATH,
 *   BRIDGE_HEALTH_PORT (separate HTTP port for /health, defaults to BRIDGE_PORT + 1)
 */
function resolveConfig(explicit: BridgeServerConfig = {}): Required<BridgeServerConfig> {
  const env = process.env;
  return {
    port: explicit.port ?? (env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_PORT),
    host: explicit.host ?? env.BRIDGE_HOST ?? DEFAULT_HOST,
    maxConnections:
      explicit.maxConnections ??
      (env.BRIDGE_MAX_CONNECTIONS ? Number(env.BRIDGE_MAX_CONNECTIONS) : DEFAULT_MAX_CONNECTIONS),
    pingIntervalMs:
      explicit.pingIntervalMs ??
      (env.BRIDGE_PING_INTERVAL_MS ? Number(env.BRIDGE_PING_INTERVAL_MS) : DEFAULT_PING_INTERVAL_MS),
    authTokens:
      explicit.authTokens ??
      (env.BRIDGE_AUTH_TOKENS ? env.BRIDGE_AUTH_TOKENS.split(',').map(t => t.trim()).filter(Boolean) : []),
    path: explicit.path ?? env.BRIDGE_PATH ?? '/',
    healthPort:
      explicit.healthPort ??
      (env.BRIDGE_HEALTH_PORT ? Number(env.BRIDGE_HEALTH_PORT) : (explicit.port ?? (env.BRIDGE_PORT ? Number(env.BRIDGE_PORT) : DEFAULT_PORT)) + 1),
  };
}

// ─── BridgeServer ─────────────────────────────────────────────────────────────

/**
 * The ClawSwarm bridge server.
 *
 * Manages WebSocket connections, authenticates clients, and routes
 * messages between agents and dashboard consumers within org boundaries.
 *
 * @example
 * ```typescript
 * const bridge = new BridgeServer({ port: 8787 });
 *
 * bridge.on('client:connected', (client) => {
 *   console.log('Connected:', client.id, 'org:', client.orgId);
 * });
 *
 * await bridge.start();
 * console.log('Bridge listening on ws://localhost:8787');
 * ```
 */
export class BridgeServer extends EventEmitter<BridgeServerEvents> {
  private readonly config: Required<BridgeServerConfig>;
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Map<string, { client: BridgeClient; socket: WebSocket }> = new Map();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private _shuttingDown = false;
  private _signalHandlers: { signal: NodeJS.Signals; handler: () => void }[] = [];

  constructor(config: BridgeServerConfig = {}) {
    super();
    this.config = resolveConfig(config);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Start the WebSocket server and HTTP health endpoint.
   * Also registers SIGTERM/SIGINT handlers for graceful shutdown.
   * Returns a promise that resolves once the server is listening.
   */
  async start(): Promise<void> {
    if (this.wss) throw new Error('BridgeServer is already running');

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        port: this.config.port,
        host: this.config.host,
        path: this.config.path,
      });

      this.wss.on('connection', (socket, req) => this._onConnection(socket, req));
      this.wss.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.wss.on('listening', () => {
        this._startPingTimer();
        this._registerSignalHandlers();
        this._startHealthServer();
        this.emit('listening', this.config.port, this.config.host);
        resolve();
      });
    });
  }

  /**
   * Gracefully stop the WebSocket server.
   *
   * 1. Stops accepting new connections.
   * 2. Sends close frames to every connected client and waits for them
   *    to drain (up to GRACEFUL_SHUTDOWN_TIMEOUT_MS).
   * 3. Forcefully terminates any remaining sockets.
   * 4. Cleans up timers and the health HTTP server.
   */
  async stop(): Promise<void> {
    if (!this.wss || this._shuttingDown) return;
    this._shuttingDown = true;

    // Stop ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Unregister signal handlers so we don't double-fire
    for (const { signal, handler } of this._signalHandlers) {
      process.removeListener(signal, handler);
    }
    this._signalHandlers = [];

    // Send close frames to all clients
    const closePromises: Promise<void>[] = [];
    for (const [_id, { socket }] of this.clients) {
      closePromises.push(
        new Promise<void>((res) => {
          const onClose = () => res();
          socket.once('close', onClose);
          try {
            socket.close(1001, 'Server shutting down');
          } catch {
            res();
          }
        })
      );
    }

    // Wait for clients to close or timeout
    await Promise.race([
      Promise.allSettled(closePromises),
      new Promise<void>((r) => setTimeout(r, GRACEFUL_SHUTDOWN_TIMEOUT_MS)),
    ]);

    // Force-terminate any lingering sockets
    for (const [_id, { socket }] of this.clients) {
      try {
        socket.terminate();
      } catch {
        // already gone
      }
    }
    this.clients.clear();

    // Close health HTTP server
    if (this.httpServer) {
      await new Promise<void>((res) => this.httpServer!.close(() => res()));
      this.httpServer = null;
    }

    // Close WSS
    await new Promise<void>((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
        this._shuttingDown = false;
        resolve();
      });
    });
  }

  /**
   * Send a message to a specific client by ID.
   * Returns false if the client is not found or not connected.
   */
  send(clientId: string, message: BridgeMessage): boolean {
    const entry = this.clients.get(clientId);
    if (!entry || entry.socket.readyState !== WebSocket.OPEN) return false;

    try {
      entry.socket.send(JSON.stringify(message));
      this.emit('message:sent', clientId, message);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast a message to all clients in an organization.
   * Optionally filter by role.
   *
   * @param orgId - Organization to broadcast to ('*' for all orgs)
   * @param message - Message to send
   * @param roles - Optional role filter
   * @returns Number of clients reached
   */
  broadcast(
    orgId: string,
    message: BridgeMessage,
    roles?: BridgeClient['role'][]
  ): number {
    let count = 0;
    for (const [, { client, socket }] of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (orgId !== '*' && client.orgId !== orgId) continue;
      if (roles && !roles.includes(client.role)) continue;
      if (!client.authenticated) continue;

      try {
        socket.send(JSON.stringify(message));
        count++;
      } catch {
        // Skip failed sends silently — the client will be cleaned up on close/error
      }
    }
    return count;
  }

  /**
   * Get all connected clients (optionally filtered by org).
   */
  getClients(orgId?: string): BridgeClient[] {
    const all = Array.from(this.clients.values()).map(e => e.client);
    return orgId ? all.filter(c => c.orgId === orgId) : all;
  }

  /**
   * Get server stats.
   */
  stats(): { connections: number; orgs: number; uptime: boolean } {
    const orgs = new Set(Array.from(this.clients.values()).map(e => e.client.orgId));
    return {
      connections: this.clients.size,
      orgs: orgs.size,
      uptime: this.wss !== null,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Handle a new WebSocket connection.
   * @internal
   */
  private _onConnection(socket: WebSocket, _req: http.IncomingMessage): void {
    // Reject new connections during shutdown
    if (this._shuttingDown) {
      socket.close(1001, 'Server shutting down');
      return;
    }

    if (this.clients.size >= this.config.maxConnections) {
      socket.close(1013, 'Server at capacity');
      return;
    }

    const clientId = uuidv4();
    const client: BridgeClient = {
      id: clientId,
      orgId: 'unknown',
      role: 'external',
      connectedAt: new Date().toISOString(),
      authenticated: this.config.authTokens.length === 0, // no auth if no tokens configured
      metadata: {},
    };

    this.clients.set(clientId, { client, socket });
    this.emit('client:connected', client);

    socket.on('message', (data) => {
      try {
        this._onMessage(clientId, data);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.send(clientId, this._errorMessage('INTERNAL_ERROR', 'Unexpected error processing message'));
      }
    });

    socket.on('close', (code, reason) => {
      try {
        this._onClose(clientId, code, reason.toString());
      } catch {
        // Ensure close never throws
        this.clients.delete(clientId);
      }
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      // Clean up on socket error to prevent leaks
      try {
        socket.terminate();
      } catch {
        // ignore
      }
      this.clients.delete(clientId);
    });

    socket.on('pong', () => {
      const entry = this.clients.get(clientId);
      if (entry) entry.client.lastPingAt = new Date().toISOString();
    });
  }

  /**
   * Handle an incoming message from a client.
   * @internal
   */
  private _onMessage(clientId: string, data: import('ws').RawData): void {
    const entry = this.clients.get(clientId);
    if (!entry) return;

    // Guard against oversized messages (1 MB limit)
    const raw = data.toString();
    if (raw.length > 1_048_576) {
      this.send(clientId, this._errorMessage('MESSAGE_TOO_LARGE', 'Message exceeds 1 MB limit'));
      return;
    }

    let message: BridgeMessage;
    try {
      message = JSON.parse(raw) as BridgeMessage;
    } catch {
      this.send(clientId, this._errorMessage('PARSE_ERROR', 'Invalid JSON'));
      return;
    }

    // Validate message shape
    if (!message || typeof message.type !== 'string') {
      this.send(clientId, this._errorMessage('INVALID_MESSAGE', 'Missing or invalid "type" field'));
      return;
    }

    // Handle auth message
    if (message.type === 'auth') {
      this._handleAuth(clientId, message.payload as AuthPayload);
      return;
    }

    // Reject unauthenticated messages
    if (!entry.client.authenticated) {
      this.send(clientId, this._errorMessage('UNAUTHORIZED', 'Authenticate first'));
      return;
    }

    // Handle ping
    if (message.type === 'ping') {
      this.send(clientId, { type: 'pong', ts: new Date().toISOString(), payload: {} });
      return;
    }

    this.emit('message:received', entry.client, message);
  }

  /**
   * Handle an auth message from a client.
   * @internal
   */
  private _handleAuth(clientId: string, payload: AuthPayload): void {
    const entry = this.clients.get(clientId);
    if (!entry) return;

    // Validate auth payload shape
    if (!payload || typeof payload.token !== 'string' || typeof payload.orgId !== 'string' || typeof payload.role !== 'string') {
      this.send(clientId, this._errorMessage('INVALID_AUTH', 'Auth payload must include token, orgId, and role'));
      entry.socket.close(1008, 'Invalid auth payload');
      return;
    }

    const { token, orgId, role, metadata } = payload;

    // Validate role
    const validRoles: string[] = ['agent', 'dashboard', 'external'];
    if (!validRoles.includes(role)) {
      this.send(clientId, this._errorMessage('INVALID_ROLE', `Role must be one of: ${validRoles.join(', ')}`));
      entry.socket.close(1008, 'Invalid role');
      return;
    }

    // Validate token if auth is configured
    if (
      this.config.authTokens.length > 0 &&
      !this.config.authTokens.includes(token)
    ) {
      this.send(clientId, this._errorMessage('INVALID_TOKEN', 'Invalid auth token'));
      entry.socket.close(1008, 'Unauthorized');
      return;
    }

    entry.client.authenticated = true;
    entry.client.orgId = orgId;
    entry.client.role = role;
    entry.client.metadata = metadata ?? {};

    this.send(clientId, {
      type: 'pong', // using pong as ack
      ts: new Date().toISOString(),
      payload: { authenticated: true, clientId },
    });

    this.emit('client:authenticated', entry.client);
  }

  /**
   * Handle a client disconnection.
   * @internal
   */
  private _onClose(clientId: string, code: number, reason: string): void {
    this.clients.delete(clientId);
    this.emit('client:disconnected', clientId, reason || String(code));
  }

  /**
   * Build an error message.
   * @internal
   */
  private _errorMessage(code: string, message: string): BridgeMessage {
    return {
      type: 'error',
      ts: new Date().toISOString(),
      payload: { code, message },
    };
  }

  /**
   * Start the ping timer for keep-alive.
   * @internal
   */
  private _startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      const now = new Date().toISOString();
      for (const [id, { socket, client }] of this.clients) {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.ping();
          } catch {
            // Ping failed — clean up
            this.clients.delete(id);
            try { socket.terminate(); } catch { /* noop */ }
          }
          client.lastPingAt = now;
        } else {
          // Clean up stale connections
          this.clients.delete(id);
        }
      }
    }, this.config.pingIntervalMs);
  }

  /**
   * Register SIGTERM/SIGINT handlers for graceful shutdown.
   * @internal
   */
  private _registerSignalHandlers(): void {
    const handle = (signal: NodeJS.Signals) => {
      const handler = () => {
        this.stop().catch((err) => {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        });
      };
      process.on(signal, handler);
      this._signalHandlers.push({ signal, handler });
    };
    handle('SIGTERM');
    handle('SIGINT');
  }

  /**
   * Start a lightweight HTTP server for /health checks.
   *
   * By default it uses the WS port + 1, but can be overridden via
   * `healthPort` config or `BRIDGE_HEALTH_PORT` env var.
   *
   * @internal
   */
  private _startHealthServer(): void {
    const port = this.config.healthPort ?? this.config.port + 1;
    this.httpServer = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
        const s = this.stats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          connections: s.connections,
          orgs: s.orgs,
          uptime: s.uptime,
        }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.httpServer.on('error', (err) => {
      // Non-fatal: log but don't crash
      this.emit('error', err);
    });

    this.httpServer.listen(port, this.config.host);
  }
}
