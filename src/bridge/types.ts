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

// ─── Convex Adapter ───────────────────────────────────────────────────────────

/**
 * A pending step returned by the Convex `/api/bridge/pending` endpoint.
 * This is the wire format from moonclawswarm's Convex backend.
 */
export interface ConvexPendingStep {
  /** Convex document ID for the step */
  stepId: string;
  /** Human-readable step name */
  stepName: string;
  /** Convex document ID for the parent run */
  runId: string;
  /** Convex document ID for the associated task (optional) */
  taskId?: string;
  /** Scope tag (e.g. 'frontend', 'backend') */
  scopeTag?: string;
  /** Tags inherited from the task */
  tags?: string[];
  /** Agent role that should handle this step */
  agentRole: string;
  /** The instruction/task description for the agent */
  task: string;
  /** Optional chained context from previous steps */
  context?: string;
  /** Number of previous attempts */
  attempts: number;
  /** Maximum number of retries allowed */
  maxRetries: number;
}

/** Result payload to POST to `/api/bridge/report` */
export interface ConvexStepResult {
  stepId: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
    cost?: number;
  };
}

/** Configuration for the ConvexBridgeAdapter */
export interface ConvexAdapterConfig {
  /**
   * The Convex deployment URL, e.g. `https://xxx.convex.cloud`.
   * The adapter will call `{convexUrl}/api/bridge/*` endpoints.
   */
  convexUrl: string;
  /**
   * Optional bridge token sent as the `X-Bridge-Token` header.
   * Must match `BRIDGE_SECRET` configured in the Convex deployment.
   */
  bridgeToken?: string;
  /**
   * How often to poll `/api/bridge/pending` in milliseconds.
   * @default 5000
   */
  pollIntervalMs?: number;
  /**
   * Optional org ID used for event scoping/logging.
   */
  orgId?: string;
  /**
   * Identifier for this adapter instance (shown in logs and claim requests).
   * @default 'clawswarm-adapter'
   */
  instanceId?: string;
}

/** Events emitted by ConvexBridgeAdapter */
export interface ConvexAdapterEvents {
  /** Fired when polling starts */
  'started': () => void;
  /** Fired when polling stops */
  'stopped': () => void;
  /** Fired each time a poll cycle completes */
  'poll': (steps: ConvexPendingStep[]) => void;
  /** Fired when a step is claimed and ready for execution */
  'step:claimed': (step: ConvexPendingStep) => void;
  /** Fired when a step result is successfully reported */
  'step:reported': (stepId: string, status: 'success' | 'error') => void;
  /** Fired on any HTTP or runtime error */
  'error': (error: Error) => void;
}

// ─── Dashboard Bridge ─────────────────────────────────────────────────────────

/**
 * Configuration for the DashboardBridge.
 */
export interface DashboardBridgeConfig {
  /**
   * The Convex site URL for the moonclawswarm deployment,
   * e.g. `https://yourdeployment.convex.site`.
   * The bridge will call `{convexSiteUrl}/api/bridge/*` endpoints.
   */
  convexSiteUrl: string;
  /**
   * Optional bridge token sent as the `X-Bridge-Token` header.
   * Must match `BRIDGE_SECRET` configured in the Convex deployment.
   */
  bridgeToken?: string;
  /**
   * Optional org ID for multi-tenant deployments.
   */
  orgId?: string;
  /**
   * How often to flush buffered stream events to the dashboard (ms).
   * @default 3000
   */
  streamIntervalMs?: number;
}

/**
 * A single stream event sent to the dashboard via `/api/bridge/stream-events`.
 * Shape matches the `storeBatch` Convex mutation schema.
 */
export interface StreamEvent {
  /** Convex run ID to associate this event with (OSS goal → Convex goal ID, or "bridge") */
  runId: string;
  /** Event type string */
  eventType: string;
  /** JSON-serialised event payload */
  payload: string;
}

/**
 * Payload sent to `/api/bridge/cost-event`.
 */
export interface CostEventPayload {
  agentId?: string;
  taskId?: string;
  /** Cost in fractional cents */
  costCents: number;
  tokenUsage: {
    input?: number;
    output?: number;
    total?: number;
  };
  model?: string;
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
  /** Port for the HTTP health endpoint (default: port + 1, or BRIDGE_HEALTH_PORT env) */
  healthPort?: number;
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
