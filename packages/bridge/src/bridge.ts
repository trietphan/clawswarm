/**
 * WebSocket bridge server for ClawSwarm.
 *
 * Provides real-time bidirectional communication between agents,
 * dashboard clients, and external consumers. Handles org-scoped
 * message routing, authentication, and connection lifecycle.
 *
 * @module @clawswarm/bridge/bridge
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'eventemitter3';
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
export class BridgeServer extends (EventEmitter as new () => EventEmitter<BridgeServerEvents>) {
  private readonly config: Required<BridgeServerConfig>;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, { client: BridgeClient; socket: WebSocket }> = new Map();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BridgeServerConfig = {}) {
    super();
    this.config = {
      port: config.port ?? DEFAULT_PORT,
      host: config.host ?? DEFAULT_HOST,
      maxConnections: config.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
      pingIntervalMs: config.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
      authTokens: config.authTokens ?? [],
      path: config.path ?? '/',
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Start the WebSocket server.
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
        this.emit('listening', this.config.port, this.config.host);
        resolve();
      });
    });
  }

  /**
   * Stop the WebSocket server and disconnect all clients.
   */
  async stop(): Promise<void> {
    if (!this.wss) return;

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Close all client connections
    for (const [id, { socket }] of this.clients) {
      socket.close(1001, 'Server shutting down');
      this.clients.delete(id);
    }

    return new Promise((resolve) => {
      this.wss!.close(() => {
        this.wss = null;
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

      socket.send(JSON.stringify(message));
      count++;
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
  private _onConnection(socket: WebSocket, _req: import('http').IncomingMessage): void {
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

    socket.on('message', (data) => this._onMessage(clientId, data));
    socket.on('close', (code, reason) => this._onClose(clientId, code, reason.toString()));
    socket.on('error', (err) => this.emit('error', err));
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

    let message: BridgeMessage;
    try {
      message = JSON.parse(data.toString()) as BridgeMessage;
    } catch {
      this.send(clientId, this._errorMessage('PARSE_ERROR', 'Invalid JSON'));
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

    const { token, orgId, role, metadata } = payload;

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
          socket.ping();
          client.lastPingAt = now;
        } else {
          // Clean up stale connections
          this.clients.delete(id);
        }
      }
    }, this.config.pingIntervalMs);
  }
}
