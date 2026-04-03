/**
 * clawswarm — Public API
 *
 * Single-package entry point. Import everything from here.
 *
 * @example
 * ```typescript
 * import { ClawSwarm, Agent, BridgeServer } from 'clawswarm-ai';
 * ```
 *
 * @module clawswarm
 */

// ─── Core ─────────────────────────────────────────────────────────────────────
export { ClawSwarm } from './core/clawswarm.js';
export { Agent } from './core/agent.js';
export { GoalManager, GoalPlanner } from './core/goal.js';
export { TaskManager } from './core/task.js';
export { ChiefReviewer } from './core/chief.js';

// ─── Bridge ───────────────────────────────────────────────────────────────────
export { BridgeServer } from './bridge/bridge.js';
export { TaskRouter } from './bridge/router.js';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  // Agent types
  AgentType,
  AgentStatus,
  AgentConfig,
  ModelId,

  // Task types
  TaskStatus,
  Task,
  Deliverable,

  // Goal types
  GoalStatus,
  Goal,
  CreateGoalInput,

  // Review types
  ReviewResult,
  ChiefReviewConfig,

  // Cost tracking
  TokenUsage,
  CostSummary,

  // Events
  SwarmEvents,

  // Config
  SwarmConfig,
  GoalResult,
} from './core/types.js';

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
} from './bridge/types.js';
