/**
 * @clawswarm/core — Public API
 *
 * The main entry point for the ClawSwarm framework.
 * Import everything you need from this barrel export.
 *
 * @example
 * ```typescript
 * import { ClawSwarm, Agent, GoalManager, TaskManager, ChiefReviewer } from '@clawswarm/core';
 * ```
 *
 * @module @clawswarm/core
 */

// ─── Main Class ───────────────────────────────────────────────────────────────
export { ClawSwarm } from './clawswarm.js';

// ─── Agent ────────────────────────────────────────────────────────────────────
export { Agent } from './agent.js';

// ─── Goal ─────────────────────────────────────────────────────────────────────
export { GoalManager, GoalPlanner } from './goal.js';

// ─── Task ─────────────────────────────────────────────────────────────────────
export { TaskManager } from './task.js';

// ─── Chief Review ─────────────────────────────────────────────────────────────
export { ChiefReviewer } from './chief.js';

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
} from './types.js';
