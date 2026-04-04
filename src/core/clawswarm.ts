/**
 * ClawSwarm — main orchestrator class.
 *
 * Creates and manages a swarm of specialist agents, decomposes goals
 * into tasks, runs the chief review pipeline, and emits events throughout.
 *
 * @module @clawswarm/core/clawswarm
 */

import { EventEmitter } from 'eventemitter3';
import { Agent } from './agent.js';
import { GoalManager, GoalPlanner } from './goal.js';
import { TaskManager } from './task.js';
import { ChiefReviewer } from './chief.js';
import {
  SwarmConfig,
  SwarmEvents,
  GoalResult,
  CreateGoalInput,
  Goal,
  Task,
  ReviewResult,
  AgentType,
} from './types.js';

// ─── ClawSwarm ────────────────────────────────────────────────────────────────

/**
 * The primary interface for the ClawSwarm framework.
 *
 * @example
 * ```typescript
 * const swarm = new ClawSwarm({
 *   agents: [
 *     Agent.research({ model: 'claude-sonnet-4' }),
 *     Agent.code({ model: 'gpt-4o' }),
 *     Agent.ops({ model: 'gemini-pro' }),
 *   ],
 *   chiefReview: { autoApproveThreshold: 8, humanReviewThreshold: 5 },
 * });
 *
 * swarm.on('task:completed', (task) => console.log('✅', task.title));
 *
 * const result = await swarm.execute(goal);
 * ```
 */
export class ClawSwarm extends EventEmitter<SwarmEvents> {
  private readonly goalManager: GoalManager;
  private readonly taskManager: TaskManager;
  private readonly planner: GoalPlanner;
  private readonly reviewer: ChiefReviewer;
  private readonly agents: Map<AgentType, Agent>;
  private readonly config: SwarmConfig;

  constructor(config: SwarmConfig) {
    super();
    this.config = config;
    this.goalManager = new GoalManager();
    this.taskManager = new TaskManager();
    this.planner = new GoalPlanner(config);
    this.reviewer = new ChiefReviewer(config.chiefReview);
    this.agents = new Map();

    // Register agents
    for (const agentConfig of config.agents) {
      const agent = new Agent(agentConfig);
      // Use last-registered agent if multiple of same type
      this.agents.set(agentConfig.type, agent);
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Create a new goal (without executing it).
   * Use `execute()` to run the goal.
   */
  createGoal(input: CreateGoalInput): Goal {
    const goal = this.goalManager.create(input);
    this.emit('goal:created', goal);
    return goal;
  }

  /**
   * Execute a goal end-to-end:
   * 1. Decompose into tasks (Planner)
   * 2. Run each task with the appropriate specialist agent
   * 3. Review each task with ChiefReviewer
   * 4. Handle rework cycles
   * 5. Return final result
   */
  async execute(goal: Goal): Promise<GoalResult> {
    const startTime = Date.now();
    let hadHumanReview = false;

    // 1. Planning phase
    this.goalManager.setStatus(goal.id, 'planning');
    this.emit('goal:planning', goal);

    const tasks = await this.planner.decompose(goal, this.taskManager);
    this.goalManager.setTasks(goal.id, tasks);

    // 2. Execution phase
    this.goalManager.setStatus(goal.id, 'in_progress');

    try {
      // Process tasks in waves, respecting dependencies
      let iterations = 0;
      const maxIterations = tasks.length * 4; // safety valve

      while (!this.taskManager.isGoalDone(goal.id) && iterations < maxIterations) {
        iterations++;

        // First, review any tasks waiting for review (from previous iteration or rework)
        const reviewTasks = this.taskManager
          .getByGoal(goal.id)
          .filter(t => t.status === 'review');

        for (const task of reviewTasks) {
          const review = await this.reviewer.review(task);
          hadHumanReview = hadHumanReview || (review.decision === 'human_review');
          await this._handleReview(task, review);
        }

        // Then, run any newly ready tasks
        const ready = this.taskManager.getReady(goal.id);
        if (ready.length === 0 && reviewTasks.length === 0) break;
        if (ready.length > 0) {
          await Promise.all(ready.map(task => this._executeTask(task)));
        }
      }

      // 3. Collect deliverables and aggregate token usage
      const completedTasks = this.taskManager
        .getByGoal(goal.id)
        .filter(t => t.status === 'completed');

      const allDeliverables = completedTasks.flatMap(t => t.deliverables);

      // Aggregate token usage from tasks
      let totalTokens = 0;
      const allTasks = this.taskManager.getByGoal(goal.id);
      for (const t of allTasks) {
        const usage = (t as unknown as Record<string, unknown>)._tokenUsage as
          { totalTokens?: number } | undefined;
        if (usage?.totalTokens) totalTokens += usage.totalTokens;
      }

      const updatedGoal = this.goalManager.setStatus(goal.id, 'completed');
      this.emit('goal:completed', updatedGoal);

      return {
        goal: updatedGoal,
        deliverables: allDeliverables,
        cost: { ...updatedGoal.cost, totalTokens },
        hadHumanReview,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const failedGoal = this.goalManager.setStatus(goal.id, 'failed');
      this.emit('goal:failed', failedGoal, err);
      throw err;
    }
  }

  /**
   * Get a registered agent by type.
   */
  getAgent(type: AgentType): Agent | undefined {
    return this.agents.get(type);
  }

  /**
   * List all registered agents.
   */
  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get the ChiefReviewer instance (for inspection or custom review logic).
   */
  getReviewer(): ChiefReviewer {
    return this.reviewer;
  }

  /**
   * Get the TaskManager instance (for direct task inspection).
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Execute a single task with the appropriate agent.
   * @internal
   */
  private async _executeTask(task: Task, opts: { reviewFeedback?: string } = {}): Promise<void> {
    const agentType = task.assignedTo ?? 'code';
    const agent = this.agents.get(agentType);

    if (!agent) {
      this.taskManager.fail(task.id, new Error(`No agent registered for type: ${agentType}`));
      return;
    }

    try {
      this.taskManager.assign(task.id, agentType);
      this.emit('task:assigned', task, agentType);

      // Inject dependency context from completed predecessor tasks
      if (task.dependsOn && task.dependsOn.length > 0) {
        const contextParts: string[] = [];
        for (const depId of task.dependsOn) {
          const depTask = this.taskManager.get(depId);
          if (depTask && depTask.deliverables.length > 0) {
            for (const d of depTask.deliverables) {
              // Truncate large deliverables to avoid token explosion
              const content = typeof d.content === 'string' && d.content.length > 4000
                ? d.content.slice(0, 4000) + '\n... [truncated]'
                : d.content;
              contextParts.push(`### ${depTask.title}\n${content}`);
            }
          }
        }
        if (contextParts.length > 0) {
          (task as unknown as Record<string, unknown>)._dependencyContext = contextParts.join('\n\n');
        }
      }

      this.taskManager.start(task.id);
      this.emit('task:started', task);

      const deliverables = await agent.execute(task, { reviewFeedback: opts.reviewFeedback });
      this.taskManager.submitForReview(task.id, deliverables);
      this.emit('task:completed', task);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.taskManager.fail(task.id, err);
      this.emit('task:failed', task, err);
    }
  }

  /**
   * Handle a chief review result for a task.
   * @internal
   */
  private async _handleReview(task: Task, review: ReviewResult): Promise<void> {
    this.emit('task:review', task, review);

    switch (review.decision) {
      case 'approved': {
        this.taskManager.approve(task.id);
        this.taskManager.complete(task.id);
        break;
      }

      case 'human_review': {
        this.emit('human:review_required', task, review);
        // In the default flow, human_review blocks until someone calls approve/reject
        // For automated flows, we treat it as approved after emitting the event
        this.taskManager.approve(task.id);
        this.taskManager.complete(task.id);
        break;
      }

      case 'rejected': {
        this.emit('task:rejected', task, review);

        // ── Circuit Breaker ──────────────────────────────────────────────────
        // If reworkCount has reached maxReworks (from swarm config, then chiefReview config),
        // escalate to human review instead of looping forever.
        const currentTask = this.taskManager.get(task.id)!;
        const maxRework =
          this.config.maxReworks ??
          this.config.chiefReview?.maxReworkCycles ??
          3;

        if (currentTask.reworkCount >= maxRework) {
          const escalationReview: ReviewResult = {
            ...review,
            decision: 'human_review',
            feedback:
              `Circuit breaker triggered: escalated to human review after ` +
              `${currentTask.reworkCount} rework cycle(s). ` +
              `Last feedback: ${review.feedback}`,
          };
          this.emit('human:review_required', currentTask, escalationReview);
          // Auto-approve escalated task so pipeline keeps moving
          this.taskManager.approve(task.id);
          this.taskManager.complete(task.id);
          break;
        }

        try {
          // Attempt rework — pass review feedback so agent can address it
          this.taskManager.rework(task.id, review.feedback);
          this.emit('task:rework', task, review);
          // Re-execute the task with review feedback injected into the prompt
          const updatedTask = this.taskManager.get(task.id)!;
          await this._executeTask(updatedTask, { reviewFeedback: review.feedback });
        } catch {
          // TaskManager.rework() threw (its own maxReworkCycles guard) — reject
          this.taskManager.reject(task.id, review.feedback);
        }
        break;
      }
    }
  }
}
