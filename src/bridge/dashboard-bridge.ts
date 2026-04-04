/**
 * DashboardBridge — Connects ClawSwarm events to the clawswarm.app dashboard.
 *
 * Listens to all ClawSwarm lifecycle events and syncs them to the
 * moonclawswarm Convex backend via HTTP so users can see live progress
 * in the dashboard.
 *
 * @example
 * ```typescript
 * const bridge = new DashboardBridge({
 *   convexSiteUrl: 'https://yourdeployment.convex.site',
 *   bridgeToken: process.env.BRIDGE_TOKEN,
 * });
 *
 * bridge.attach(swarm);
 * await swarm.execute(goal);
 * bridge.detach();
 * ```
 *
 * @module @clawswarm/bridge/dashboard-bridge
 */

import { ClawSwarm } from '../core/clawswarm.js';
import type {
  Goal,
  Task,
  AgentType,
  ReviewResult,
} from '../core/types.js';
import type {
  DashboardBridgeConfig,
  StreamEvent,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_STREAM_INTERVAL_MS = 3_000;

/**
 * Map OSS agent types to moonclawswarm dashboard role names.
 * The OSS framework uses short names; the dashboard uses full role identifiers.
 */
const ROLE_MAP: Record<string, string> = {
  research: 'researcher',
  code: 'developer',
  ops: 'ops',
  planner: 'planner',
  custom: 'developer', // fallback
};

// ─── DashboardBridge ─────────────────────────────────────────────────────────

/**
 * Bridges ClawSwarm events to the clawswarm.app dashboard via HTTP.
 *
 * Call `attach(swarm)` before executing goals and `detach()` when done.
 * The bridge maintains ID mappings between OSS string IDs (e.g. `goal-xxx`)
 * and the dashboard's Convex document IDs.
 */
export class DashboardBridge {
  private readonly config: Required<DashboardBridgeConfig>;

  /** Maps OSS goal IDs → Convex goal IDs */
  private readonly goalIdMap = new Map<string, string>();
  /** Maps OSS goal IDs → Convex board IDs (one board per goal) */
  private readonly boardIdMap = new Map<string, string>();
  /** Maps OSS task IDs → Convex task IDs */
  private readonly taskIdMap = new Map<string, string>();
  /** Maps OSS agent types → Convex agent IDs (populated from agent-start responses) */
  private readonly agentIdMap = new Map<string, string>();

  /** The current goal ID being processed (used as runId context for stream events) */
  private _currentGoalId = 'bridge';

  /** Pending stream events waiting to be flushed */
  private readonly pendingEvents: StreamEvent[] = [];
  /** Timer handle for periodic stream flush */
  private streamTimer: ReturnType<typeof setInterval> | null = null;

  /** Accumulated token usage per goal: goalId → tokens */
  private readonly tokenUsage = new Map<string, number>();
  /** Accumulated cost per goal: goalId → costCents */
  private readonly costCents = new Map<string, number>();

  /** Bound listener references so we can remove them on detach */
  private _attached: ClawSwarm | null = null;

  // Keep references to bound handlers for removeListener
  private readonly _onGoalCreated = this._handleGoalCreated.bind(this);
  private readonly _onGoalPlanning = this._handleGoalPlanning.bind(this);
  private readonly _onGoalCompleted = this._handleGoalCompleted.bind(this);
  private readonly _onGoalFailed = this._handleGoalFailed.bind(this);
  private readonly _onTaskAssigned = this._handleTaskAssigned.bind(this);
  private readonly _onTaskStarted = this._handleTaskStarted.bind(this);
  private readonly _onTaskCompleted = this._handleTaskCompleted.bind(this);
  private readonly _onTaskReview = this._handleTaskReview.bind(this);
  private readonly _onTaskFailed = this._handleTaskFailed.bind(this);
  private readonly _onHumanReviewRequired = this._handleHumanReviewRequired.bind(this);

  constructor(config: DashboardBridgeConfig) {
    if (!config.convexSiteUrl) {
      throw new Error('DashboardBridge: convexSiteUrl is required');
    }

    this.config = {
      convexSiteUrl: config.convexSiteUrl.replace(/\/+$/, ''),
      bridgeToken: config.bridgeToken ?? '',
      orgId: config.orgId ?? '',
      streamIntervalMs: config.streamIntervalMs ?? DEFAULT_STREAM_INTERVAL_MS,
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Attach to a ClawSwarm instance and start syncing events to the dashboard.
   * Idempotent — calling attach on an already-attached swarm is a no-op.
   */
  attach(swarm: ClawSwarm): void {
    if (this._attached === swarm) return;
    if (this._attached) this.detach();

    this._attached = swarm;

    swarm.on('goal:created', this._onGoalCreated);
    swarm.on('goal:planning', this._onGoalPlanning);
    swarm.on('goal:completed', this._onGoalCompleted);
    swarm.on('goal:failed', this._onGoalFailed);
    swarm.on('task:assigned', this._onTaskAssigned);
    swarm.on('task:started', this._onTaskStarted);
    swarm.on('task:completed', this._onTaskCompleted);
    swarm.on('task:review', this._onTaskReview);
    swarm.on('task:failed', this._onTaskFailed);
    swarm.on('human:review_required', this._onHumanReviewRequired);

    // Start periodic stream flush
    this.streamTimer = setInterval(
      () => { void this._flushStreamEvents(); },
      this.config.streamIntervalMs,
    );
  }

  /**
   * Detach from the current ClawSwarm instance and stop syncing.
   * Flushes any pending stream events before stopping.
   */
  detach(): void {
    if (!this._attached) return;

    const swarm = this._attached;
    this._attached = null;

    swarm.off('goal:created', this._onGoalCreated);
    swarm.off('goal:planning', this._onGoalPlanning);
    swarm.off('goal:completed', this._onGoalCompleted);
    swarm.off('goal:failed', this._onGoalFailed);
    swarm.off('task:assigned', this._onTaskAssigned);
    swarm.off('task:started', this._onTaskStarted);
    swarm.off('task:completed', this._onTaskCompleted);
    swarm.off('task:review', this._onTaskReview);
    swarm.off('task:failed', this._onTaskFailed);
    swarm.off('human:review_required', this._onHumanReviewRequired);

    if (this.streamTimer !== null) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }

    // Final flush (fire-and-forget)
    void this._flushStreamEvents();
  }

  /**
   * Resolve the dashboard Convex goal ID for an OSS goal ID.
   * Returns undefined if the goal has not been synced yet.
   */
  getDashboardGoalId(ossGoalId: string): string | undefined {
    return this.goalIdMap.get(ossGoalId);
  }

  /**
   * Resolve the dashboard Convex task ID for an OSS task ID.
   * Returns undefined if the task has not been synced yet.
   */
  getDashboardTaskId(ossTaskId: string): string | undefined {
    return this.taskIdMap.get(ossTaskId);
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  private _handleGoalCreated(goal: Goal): void {
    this._currentGoalId = goal.id;
    void this._syncGoalCreated(goal);
  }

  private _handleGoalPlanning(goal: Goal): void {
    this._currentGoalId = goal.id;
    void this._syncGoalUpdate(goal, 'active');
  }

  private _handleGoalCompleted(goal: Goal): void {
    this._currentGoalId = goal.id;

    // Only send cost event if we have a Convex agent ID from a prior agent-start response
    const tokens = this.tokenUsage.get(goal.id) ?? 0;
    const cents = this.costCents.get(goal.id) ?? 0;
    if ((tokens > 0 || cents > 0) && this.agentIdMap.size > 0) {
      const agentId = this.agentIdMap.values().next().value;
      if (agentId) {
        void this._post('/api/bridge/cost-event', {
          agentId,
          inputTokens: 0,
          outputTokens: tokens,
          costCents: cents,
          model: 'unknown',
          source: 'clawswarm',
        }).catch(() => undefined);
      }
    }

    const summary = goal.deliverables
      .map(d => d.label)
      .join(', ') || 'Goal completed successfully';

    void this._syncGoalUpdate(goal, 'achieved', summary);
    this._queueStreamEvent('goal:completed', { goalId: goal.id, title: goal.title });
  }

  private _handleGoalFailed(goal: Goal, _error: Error): void {
    this._currentGoalId = goal.id;
    void this._syncGoalUpdate(goal, 'failed');
    this._queueStreamEvent('goal:failed', { goalId: goal.id, title: goal.title });
  }

  private _handleTaskAssigned(task: Task, _agentType: AgentType): void {
    void this._syncTaskAssigned(task);
  }

  private _handleTaskStarted(task: Task): void {
    const dashTaskId = this.taskIdMap.get(task.id);
    if (!dashTaskId) return;

    const ossRole = task.assignedTo ?? 'code';
    const role = ROLE_MAP[ossRole] ?? ossRole;
    void this._post('/api/bridge/agent-start', {
      role,
      taskId: dashTaskId,
    }).then(async (res) => {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      // Store the Convex agent ID for later cost event attribution
      if (data['ok'] === true && typeof data['agentId'] === 'string') {
        this.agentIdMap.set(role, data['agentId'] as string);
      }
    }).catch(() => undefined);

    this._queueStreamEvent('task:started', { taskId: task.id, title: task.title, role });
  }

  private _handleTaskCompleted(task: Task): void {
    const dashTaskId = this.taskIdMap.get(task.id);
    if (!dashTaskId) return;

    // Don't call /api/bridge/report — that endpoint expects a stepId from the steps
    // table which tasks don't have. Use a stream event for completion tracking instead.
    this._queueStreamEvent('task:completed', {
      taskId: task.id,
      dashTaskId,
      title: task.title,
      output: task.deliverables.map(d => d.content).join('\n\n'),
    });

    // Signal agent-done to decrement activeSpawns on the dashboard
    const ossRole = task.assignedTo ?? 'code';
    const role = ROLE_MAP[ossRole] ?? ossRole;
    void this._post('/api/bridge/agent-done', { role }).catch(() => undefined);
  }

  private _handleTaskReview(task: Task, review: ReviewResult): void {
    const dashTaskId = this.taskIdMap.get(task.id);
    if (!dashTaskId) return;

    // Map OSS decision to Convex chiefReview mutation format:
    // "approved" → "approve", "rejected" → "rework" (terminal reject is rare), "human_review" → keep
    const decision = review.decision === 'approved'
      ? 'approve'
      : review.decision === 'rejected'
        ? 'rework'
        : 'needs_human_review';

    void this._post('/api/bridge/chief-review', {
      taskId: dashTaskId,
      decision,
      feedback: review.feedback,
      qualityScore: review.score,
    }).catch(() => undefined);

    this._queueStreamEvent('task:review', {
      taskId: task.id,
      title: task.title,
      decision,
      score: review.score,
    });
  }

  private _handleTaskFailed(task: Task, error: Error): void {
    const dashTaskId = this.taskIdMap.get(task.id);
    if (!dashTaskId) return;

    // Don't call /api/bridge/report — expects stepId. Use stream events instead.
    this._queueStreamEvent('task:failed', {
      taskId: task.id,
      dashTaskId,
      title: task.title,
      error: error.message,
    });

    // Free the agent on failure too
    const ossRole = task.assignedTo ?? 'code';
    const role = ROLE_MAP[ossRole] ?? ossRole;
    void this._post('/api/bridge/agent-done', { role }).catch(() => undefined);
  }

  private _handleHumanReviewRequired(task: Task, review: ReviewResult): void {
    const dashTaskId = this.taskIdMap.get(task.id);
    if (!dashTaskId) return;

    void this._post('/api/bridge/escalate-to-human', {
      taskId: dashTaskId,
      chiefScore: review.score,
      chiefFeedback: review.feedback,
    }).catch(() => undefined);

    this._queueStreamEvent('human:review_required', {
      taskId: task.id,
      title: task.title,
      score: review.score,
    });
  }

  // ─── Sync Helpers ────────────────────────────────────────────────────────

  private async _syncGoalCreated(goal: Goal): Promise<void> {
    try {
      const body: Record<string, unknown> = {
        name: goal.title,
        description: goal.description ?? goal.title,
        status: 'active',
      };
      if (this.config.orgId) body['orgId'] = this.config.orgId;

      const res = await this._post('/api/bridge/create-goal', body);
      const data = await res.json() as Record<string, unknown>;
      const dashGoalId = data['goalId'] as string | undefined;
      if (dashGoalId) {
        this.goalIdMap.set(goal.id, dashGoalId);

        // Create a board for this goal immediately
        await this._syncCreateBoard(goal, dashGoalId);
      }
    } catch {
      // Non-fatal — the swarm continues even if the dashboard is unreachable
    }

    this._queueStreamEvent('goal:created', { goalId: goal.id, title: goal.title });
  }

  private async _syncCreateBoard(goal: Goal, dashGoalId: string): Promise<void> {
    try {
      const res = await this._post('/api/bridge/create-board', {
        name: goal.title,
        description: goal.description ?? goal.title,
        goalId: dashGoalId,
      });
      const data = await res.json() as Record<string, unknown>;
      const boardId = data['boardId'] as string | undefined;
      if (boardId) {
        this.boardIdMap.set(goal.id, boardId);
      }
    } catch {
      // Non-fatal
    }
  }

  private async _syncGoalUpdate(
    goal: Goal,
    status: string,
    completionSummary?: string,
  ): Promise<void> {
    const dashGoalId = this.goalIdMap.get(goal.id);
    if (!dashGoalId) return;

    try {
      const body: Record<string, unknown> = { goalId: dashGoalId, status };
      if (completionSummary) body['completionSummary'] = completionSummary;
      await this._post('/api/bridge/update-goal', body);
    } catch {
      // Non-fatal
    }
  }

  private async _syncTaskAssigned(task: Task): Promise<void> {
    const dashGoalId = this.goalIdMap.get(task.goalId);
    const boardId = this.boardIdMap.get(task.goalId);

    if (!dashGoalId || !boardId) {
      // Goal not yet synced — we can't create the task on the dashboard
      return;
    }

    try {
      const res = await this._post('/api/bridge/create-task', {
        boardId,
        title: task.title,
        description: task.description,
        priority: 'medium',
        tags: [],
        goalId: dashGoalId,
      });
      const data = await res.json() as Record<string, unknown>;
      const dashTaskId = data['taskId'] as string | undefined;
      if (dashTaskId) {
        this.taskIdMap.set(task.id, dashTaskId);
      }
    } catch {
      // Non-fatal
    }

    this._queueStreamEvent('task:assigned', {
      taskId: task.id,
      title: task.title,
      assignedTo: task.assignedTo ?? 'code',
    });
  }

  // ─── Stream Events ───────────────────────────────────────────────────────

  private _queueStreamEvent(type: string, data: Record<string, unknown>): void {
    // Resolve runId: use Convex goal ID if available, otherwise OSS goal ID or 'bridge'
    const ossGoalId = data['goalId'] as string | undefined;
    const runId = (ossGoalId ? this.goalIdMap.get(ossGoalId) : undefined)
      ?? this.goalIdMap.get(this._currentGoalId)
      ?? this._currentGoalId;

    this.pendingEvents.push({
      runId,
      eventType: type,
      payload: JSON.stringify(data),
    });
  }

  private async _flushStreamEvents(): Promise<void> {
    if (this.pendingEvents.length === 0) return;

    // Drain the queue atomically
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);

    try {
      await this._post('/api/bridge/stream-events', { events });
    } catch {
      // Non-fatal — drop the events rather than crashing
    }
  }

  // ─── HTTP Helper ─────────────────────────────────────────────────────────

  private async _post(path: string, body: unknown): Promise<Response> {
    const url = `${this.config.convexSiteUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.bridgeToken) {
      headers['X-Bridge-Token'] = this.config.bridgeToken;
    }
    if (this.config.orgId) {
      headers['X-Org-Id'] = this.config.orgId;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `POST ${path} failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`,
      );
    }

    return response;
  }
}
