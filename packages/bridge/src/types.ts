/**
 * Bridge-specific types for the ClawSwarm WebSocket bridge server.
 * @module @clawswarm/bridge/types
 */

// ─── Client Connection ────────────────────────────────────────────────────────

/** Role of a connected client */
export type ClientRole = 'agent' | 'dashboard' | 'external';

/** A connected WebSocket client */
export interface BridgeClient {
  /** Unique connection ID */
  id: string;
  /** Organization this client belongs to */
  orgId: string;
  /** Client role */
  role: ClientRole;
  /** ISO timestamp of connection */
  connectedAt: string;
  /** Last ping/pong timestamp */
  lastPingAt?: string;
  /** Whether the client is authenticated */
  authenticated: boolean;
  /** Metadata from the handshake */
  metadata: Record<string, string>;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** All message types the bridge can handle */
export type BridgeMessageType =
  | 'auth'
  | 'ping'
  | 'pong'
  | 'goal:created'
  | 'goal:planning'
  | 'goal:completed'
  | 'goal:failed'
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:review'
  | 'task:rejected'
  | 'task:rework'
  | 'task:failed'
  | 'human:review_required'
  | 'agent:status'
  | 'error';

/** Base shape of all bridge messages */
export interface BridgeMessage<T = unknown> {
  /** Message type */
  type: BridgeMessageType;
  /** ISO timestamp */
  ts: string;
  /** Organization ID (for routing) */
  orgId?: string;
  /** Message payload */
  payload: T;
  /** Optional correlation ID for request/response pairs */
  correlationId?: string;
}

/** Auth message payload (client → server) */
export interface AuthPayload {
  token: string;
  orgId: string;
  role: ClientRole;
  metadata?: Record<string, string>;
}

/** Error message payload */
export interface ErrorPayload {
  code: string;
  message: string;
  correlationId?: string;
}

/** Agent status update payload */
export interface AgentStatusPayload {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentTaskId?: string;
}

// ─── Router ───────────────────────────────────────────────────────────────────

/** A routing rule that maps message types to handler functions */
export interface RoutingRule {
  /** Message type to match */
  messageType: BridgeMessageType | '*';
  /** Org IDs to route to (empty = all orgs) */
  orgIds?: string[];
  /** Client roles to route to (empty = all roles) */
  roles?: ClientRole[];
}

// ─── Server Config ────────────────────────────────────────────────────────────

/** Configuration for the BridgeServer */
export interface BridgeServerConfig {
  /** Port to listen on (default: 8787) */
  port?: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Maximum concurrent connections (default: 1000) */
  maxConnections?: number;
  /** Ping interval in ms (default: 30000) */
  pingIntervalMs?: number;
  /** Allowed auth tokens — empty array means no auth required */
  authTokens?: string[];
  /** Path prefix for WebSocket endpoint (default: '/') */
  path?: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** Events emitted by BridgeServer */
export interface BridgeServerEvents {
  'client:connected': (client: BridgeClient) => void;
  'client:disconnected': (clientId: string, reason: string) => void;
  'client:authenticated': (client: BridgeClient) => void;
  'message:received': (client: BridgeClient, message: BridgeMessage) => void;
  'message:sent': (clientId: string, message: BridgeMessage) => void;
  'error': (error: Error) => void;
  'listening': (port: number, host: string) => void;
}
