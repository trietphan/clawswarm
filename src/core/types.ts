/**
 * Shared types for the ClawSwarm core framework.
 * @module @clawswarm/core/types
 */

// ─── Model Providers ──────────────────────────────────────────────────────────

/** Supported LLM model identifiers */
export type ModelId =
  | 'claude-sonnet-4'
  | 'claude-opus-4'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gemini-pro'
  | 'gemini-flash'
  | string; // allow custom model IDs

// ─── Agent Types ──────────────────────────────────────────────────────────────

/** Agent specializations available in ClawSwarm */
export type AgentType = 'research' | 'code' | 'ops' | 'planner' | 'custom';

/** Current status of an agent */
export type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';

/** Configuration for creating an agent */
export interface AgentConfig {
  /** Agent type/specialization */
  type: AgentType;
  /** LLM model to use */
  model: ModelId;
  /** Optional display name */
  name?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Max tokens per request */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Tools/capabilities this agent has access to */
  tools?: string[];
}

// ─── Task Types ───────────────────────────────────────────────────────────────

/** Task lifecycle states */
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'rework'
  | 'completed'
  | 'failed';

/** A deliverable produced by a task */
export interface Deliverable {
  /** Type of deliverable */
  type: 'text' | 'code' | 'file' | 'url' | 'data';
  /** Human-readable label */
  label: string;
  /** The content */
  content: string;
  /** MIME type if applicable */
  mimeType?: string;
  /** File path if type is 'file' */
  filePath?: string;
}

/** A task within a goal */
export interface Task {
  /** Unique task ID */
  id: string;
  /** Parent goal ID */
  goalId: string;
  /** Task title */
  title: string;
  /** Detailed description of what to do */
  description: string;
  /** Current lifecycle status */
  status: TaskStatus;
  /** Agent type assigned to this task */
  assignedTo?: AgentType;
  /** Task outputs/deliverables */
  deliverables: Deliverable[];
  /** Number of rework cycles attempted */
  reworkCount: number;
  /** Max rework cycles allowed */
  maxReworkCycles: number;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when last updated */
  updatedAt: string;
  /** Dependencies: task IDs that must complete before this one */
  dependsOn: string[];
}

// ─── Goal Types ───────────────────────────────────────────────────────────────

/** Goal lifecycle states */
export type GoalStatus =
  | 'created'
  | 'planning'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'failed';

/** Input for creating a goal */
export interface CreateGoalInput {
  /** Short title for the goal */
  title: string;
  /** Full description of what to accomplish */
  description: string;
  /** Priority (higher = more urgent) */
  priority?: number;
  /** Deadline as ISO timestamp */
  deadline?: string;
  /** Tags for categorization */
  tags?: string[];
}

/** A goal with all its tasks */
export interface Goal extends CreateGoalInput {
  /** Unique goal ID */
  id: string;
  /** Current status */
  status: GoalStatus;
  /** Tasks decomposed from this goal */
  tasks: Task[];
  /** Combined deliverables from all completed tasks */
  deliverables: Deliverable[];
  /** Cost tracking */
  cost: CostSummary;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp when completed */
  completedAt?: string;
}

// ─── Chief Review Types ───────────────────────────────────────────────────────

/** Result of a chief review */
export interface ReviewResult {
  /** Task ID that was reviewed */
  taskId: string;
  /** Score from 0-10 */
  score: number;
  /** Decision based on score thresholds */
  decision: 'approved' | 'human_review' | 'rejected';
  /** Reviewer's feedback */
  feedback: string;
  /** Specific issues found (if any) */
  issues: string[];
  /** Suggestions for improvement */
  suggestions: string[];
  /** ISO timestamp of review */
  reviewedAt: string;
}

/** Configuration for the chief review pipeline */
export interface ChiefReviewConfig {
  /** Score threshold for auto-approval (default: 8) */
  autoApproveThreshold?: number;
  /** Score threshold for human review (default: 5) */
  humanReviewThreshold?: number;
  /** Model to use for the reviewer */
  reviewerModel?: ModelId;
  /** Custom review criteria */
  criteria?: string[];
}

// ─── Cost Tracking ────────────────────────────────────────────────────────────

/** Token usage for a single request */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Cost summary for a goal or task */
export interface CostSummary {
  /** Total tokens used */
  totalTokens: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** Per-agent breakdown */
  byAgent: Record<string, { tokens: number; costUsd: number }>;
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** Events emitted by ClawSwarm */
export interface SwarmEvents {
  'goal:created': (goal: Goal) => void;
  'goal:planning': (goal: Goal) => void;
  'goal:completed': (goal: Goal) => void;
  'goal:failed': (goal: Goal, error: Error) => void;
  'task:assigned': (task: Task, agentType: AgentType) => void;
  'task:started': (task: Task) => void;
  'task:completed': (task: Task) => void;
  'task:review': (task: Task, review: ReviewResult) => void;
  'task:rejected': (task: Task, review: ReviewResult) => void;
  'task:rework': (task: Task, review: ReviewResult) => void;
  'task:failed': (task: Task, error: Error) => void;
  'human:review_required': (task: Task, review: ReviewResult) => void;
}

// ─── Swarm Config ─────────────────────────────────────────────────────────────

/** Top-level ClawSwarm configuration */
export interface SwarmConfig {
  /** Agents to deploy */
  agents: AgentConfig[];
  /** Chief review configuration */
  chiefReview?: ChiefReviewConfig;
  /** Bridge URL for real-time communication */
  bridgeUrl?: string;
  /** Organization ID (for multi-tenant setups) */
  orgId?: string;
  /** Max concurrent goals */
  maxConcurrentGoals?: number;
}

/** Result of executing a goal */
export interface GoalResult {
  /** The completed goal */
  goal: Goal;
  /** All deliverables from all tasks */
  deliverables: Deliverable[];
  /** Total cost */
  cost: CostSummary;
  /** Whether any tasks required human review */
  hadHumanReview: boolean;
  /** Duration in milliseconds */
  durationMs: number;
}
