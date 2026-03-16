/**
 * @clawswarm/bridge — Public API
 *
 * @example
 * ```typescript
 * import { BridgeServer, TaskRouter } from '@clawswarm/bridge';
 * ```
 *
 * @module @clawswarm/bridge
 */

export { BridgeServer } from './bridge.js';
export { TaskRouter } from './router.js';

export type {
  BridgeClient,
  ClientRole,
  BridgeMessage,
  BridgeMessageType,
  BridgeServerConfig,
  BridgeServerEvents,
  AuthPayload,
  ErrorPayload,
  AgentStatusPayload,
  RoutingRule,
} from './types.js';
