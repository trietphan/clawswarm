/**
 * DashboardReporter — Lightweight OSS-to-Dashboard event bridge.
 *
 * Sends lifecycle events from `clawswarm run` to the clawswarm.app
 * dashboard via a single HTTP POST endpoint.
 *
 * Configuration via environment variables:
 *   CLAWSWARM_API_KEY       — Required. Activates reporting when set.
 *   CLAWSWARM_DASHBOARD_URL — Optional. Defaults to https://clawswarm.app
 *
 * All calls are fire-and-forget; failures are silently swallowed so
 * dashboard unavailability never blocks agent execution.
 *
 * @example
 * ```typescript
 * const reporter = DashboardReporter.fromEnv();
 * reporter.runStarted({ runId: 'run-1', goal: 'Write tests' });
 * reporter.taskCreated({ runId: 'run-1', taskId: 'task-1', title: 'Research' });
 * reporter.stepStarted({ runId: 'run-1', stepId: 'step-1', agentRole: 'researcher' });
 * reporter.stepCompleted({ runId: 'run-1', stepId: 'step-1', output: 'Done' });
 * reporter.taskCompleted({ runId: 'run-1', taskId: 'task-1' });
 * reporter.runCompleted({ runId: 'run-1', summary: 'All done' });
 * ```
 *
 * @module @clawswarm/dashboard-reporter
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

export type DashboardEventType =
  | 'run.started'
  | 'run.completed'
  | 'task.created'
  | 'task.completed'
  | 'step.started'
  | 'step.completed';

export interface DashboardEvent {
  /** Event type */
  type: DashboardEventType;
  /** ISO timestamp */
  timestamp: string;
  /** The run this event belongs to */
  runId: string;
  /** Optional task ID */
  taskId?: string;
  /** Optional step ID */
  stepId?: string;
  /** Event-specific data */
  data?: Record<string, unknown>;
}

// ─── Reporter Payloads ────────────────────────────────────────────────────────

export interface RunStartedPayload {
  runId: string;
  goal: string;
  metadata?: Record<string, unknown>;
}

export interface RunCompletedPayload {
  runId: string;
  summary?: string;
  durationMs?: number;
  error?: string;
}

export interface TaskCreatedPayload {
  runId: string;
  taskId: string;
  title: string;
  description?: string;
  agentRole?: string;
}

export interface TaskCompletedPayload {
  runId: string;
  taskId: string;
  output?: string;
  error?: string;
}

export interface StepStartedPayload {
  runId: string;
  stepId: string;
  agentRole?: string;
  taskId?: string;
}

export interface StepCompletedPayload {
  runId: string;
  stepId: string;
  taskId?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface DashboardReporterConfig {
  /**
   * API key sent as `Authorization: Bearer <apiKey>`.
   * If not provided, all reporting is disabled.
   */
  apiKey?: string;
  /**
   * Base URL of the dashboard backend.
   * @default 'https://clawswarm.app'
   */
  dashboardUrl?: string;
}

// ─── DashboardReporter ───────────────────────────────────────────────────────

/**
 * Sends OSS ClawSwarm lifecycle events to the clawswarm.app dashboard.
 *
 * Opt-in — no-op if `CLAWSWARM_API_KEY` is not set.
 * Fire-and-forget — never blocks or throws.
 */
export class DashboardReporter {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly enabled: boolean;

  constructor(config: DashboardReporterConfig = {}) {
    this.apiKey = config.apiKey ?? '';
    const baseUrl = (config.dashboardUrl ?? 'https://clawswarm.app').replace(/\/+$/, '');
    this.endpoint = `${baseUrl}/api/bridge/events`;
    this.enabled = this.apiKey.length > 0;
  }

  /**
   * Create a reporter from environment variables.
   * - `CLAWSWARM_API_KEY` — activates reporting
   * - `CLAWSWARM_DASHBOARD_URL` — overrides dashboard URL
   */
  static fromEnv(): DashboardReporter {
    return new DashboardReporter({
      apiKey: process.env['CLAWSWARM_API_KEY'],
      dashboardUrl: process.env['CLAWSWARM_DASHBOARD_URL'],
    });
  }

  /** Whether reporting is active (API key configured). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Report that a run has started. */
  runStarted(payload: RunStartedPayload): void {
    this._send({
      type: 'run.started',
      runId: payload.runId,
      data: {
        goal: payload.goal,
        ...payload.metadata,
      },
    });
  }

  /** Report that a run has completed (or failed). */
  runCompleted(payload: RunCompletedPayload): void {
    this._send({
      type: 'run.completed',
      runId: payload.runId,
      data: {
        summary: payload.summary,
        durationMs: payload.durationMs,
        error: payload.error,
      },
    });
  }

  /** Report that a task has been created. */
  taskCreated(payload: TaskCreatedPayload): void {
    this._send({
      type: 'task.created',
      runId: payload.runId,
      taskId: payload.taskId,
      data: {
        title: payload.title,
        description: payload.description,
        agentRole: payload.agentRole,
      },
    });
  }

  /** Report that a task has completed. */
  taskCompleted(payload: TaskCompletedPayload): void {
    this._send({
      type: 'task.completed',
      runId: payload.runId,
      taskId: payload.taskId,
      data: {
        output: payload.output,
        error: payload.error,
      },
    });
  }

  /** Report that a step has started. */
  stepStarted(payload: StepStartedPayload): void {
    this._send({
      type: 'step.started',
      runId: payload.runId,
      stepId: payload.stepId,
      taskId: payload.taskId,
      data: {
        agentRole: payload.agentRole,
      },
    });
  }

  /** Report that a step has completed. */
  stepCompleted(payload: StepCompletedPayload): void {
    this._send({
      type: 'step.completed',
      runId: payload.runId,
      stepId: payload.stepId,
      taskId: payload.taskId,
      data: {
        output: payload.output,
        error: payload.error,
        durationMs: payload.durationMs,
        tokenUsage: payload.tokenUsage,
      },
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget HTTP POST. Never throws, never awaited by callers.
   * Failures are silently swallowed to keep dashboard issues from
   * interrupting agent execution.
   */
  private _send(event: Omit<DashboardEvent, 'timestamp'>): void {
    if (!this.enabled) return;

    const payload: DashboardEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    // Fire and forget — intentionally not awaited
    fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Silently swallow — dashboard availability must not block execution
    });
  }
}
