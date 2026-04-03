/**
 * ClawSwarm — the top-level orchestrator.
 * @module @clawswarm/core/swarm
 */

import { EventEmitter } from 'eventemitter3';
import {
  SwarmConfig,
  GoalResult,
  CreateGoalInput,
  Goal,
  Task,
  AgentType,
  SwarmEvents,
} from './types.js';
import { Agent } from './agent.js';
import { TaskManager } from './task.js';
import { GoalManager, GoalPlanner } from './goal.js';
import { ChiefReviewer } from './chief.js';

/**
 * ClawSwarm — deploy and orchestrate a team of AI agents.
 *
 * @example
 * ```typescript
 * const swarm = new ClawSwarm({
 *   agents: [
 *     Agent.research({ model: 'claude-sonnet-4' }),
 *     Agent.code({ model: 'gpt-4o' }),
 *     Agent.ops({ model: 'gemini-pro' }),
 *   ],
 *   chiefReview: {
 *     autoApproveThreshold: 8,
 *     humanReviewThreshold: 5,
 *   },
 * });
 *
 * swarm.on('task:completed', (task) => console.log('Done:', task.title));
 *
 * const goal = await swarm.createGoal({
 *   title: 'Write a blog post about AI',
 *   description: 'Research AI trends and write a 1000-word post',
 * });
 *
 * const result = await swarm.execute(goal);
 * ```
 */
export class ClawSwarm extends EventEmitter<SwarmEvents> {
  private readonly config: SwarmConfig;
  private readonly agents: Agent[];
  private readonly taskManager: TaskManager;
  private readonly goalManager: GoalManager;
  private readonly planner: GoalPlanner;
  private readonly reviewer: ChiefReviewer;

  constructor(config: SwarmConfig) {
    super();
    this.config = config;
    this.agents = config.agents.map(c => new Agent(c));
    this.taskManager = new TaskManager();
    this.goalManager = new GoalManager();
    this.planner = new GoalPlanner(config);
    this.reviewer = new ChiefReviewer(config.chiefReview);
  }

  /**
   * Create a new goal. Does not start execution yet.
   *
   * @param input - Goal title, description, and optional metadata
   * @returns The created goal
   */
  async createGoal(input: CreateGoalInput): Promise<Goal> {
    const goal = this.goalManager.create(input);
    this.emit('goal:created', goal);
    return goal;
  }

  /**
   * Execute a goal: plan, assign, run, review, and collect results.
   *
   * @param goal - The goal to execute (from createGoal)
   * @returns Final result with deliverables and cost summary
   */
  async execute(goal: Goal): Promise<GoalResult> {
    const startTime = Date.now();

    try {
      // 1. Planning phase
      this.goalManager.setStatus(goal.id, 'planning');
      this.emit('goal:planning', goal);

      const tasks = await this.planner.decompose(goal, this.taskManager);
      this.goalManager.setTasks(goal.id, tasks);

      // 2. Execution phase
      this.goalManager.setStatus(goal.id, 'in_progress');

      let hadHumanReview = false;

      // Execute tasks in dependency order
      while (!this.taskManager.isGoalDone(goal.id)) {
        const readyTasks = this.taskManager.getReady(goal.id);
        if (readyTasks.length === 0) break;

        // Run all ready tasks (can parallelize)
        await Promise.all(
          readyTasks.map(async (task) => {
            const result = await this._executeTask(task);
            if (result.hadHumanReview) hadHumanReview = true;
          })
        );
      }

      // 3. Collect results
      const completedTasks = this.taskManager
        .getByGoal(goal.id)
        .filter(t => t.status === 'completed');

      const deliverables = completedTasks.flatMap(t => t.deliverables);

      const finalGoal = this.goalManager.setStatus(goal.id, 'completed');
      this.emit('goal:completed', finalGoal);

      return {
        goal: finalGoal,
        deliverables,
        cost: finalGoal.cost,
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
   * Get all agents in this swarm.
   */
  getAgents(): Agent[] {
    return [...this.agents];
  }

  /**
   * Get an agent by type.
   */
  getAgent(type: AgentType): Agent | undefined {
    return this.agents.find(a => a.type === type && a.status === 'idle');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _executeTask(task: Task): Promise<{ hadHumanReview: boolean }> {
    let hadHumanReview = false;

    try {
      // Assign to agent
      const agentType = task.assignedTo ?? 'code';
      const agent = this.getAgent(agentType);

      if (!agent) {
        throw new Error(`No available agent of type: ${agentType}`);
      }

      this.taskManager.assign(task.id, agentType);
      this.emit('task:assigned', task, agentType);

      // Execute
      agent.status = 'busy';
      this.taskManager.start(task.id);
      this.emit('task:started', task);

      const deliverables = await agent.execute(task);
      agent.status = 'idle';

      // Submit for review
      const updatedTask = this.taskManager.submitForReview(task.id, deliverables);

      // Run through chief review
      let approved = false;
      while (!approved) {
        const review = await this.reviewer.review(updatedTask);
        this.emit('task:review', updatedTask, review);

        if (review.decision === 'approved') {
          this.taskManager.approve(task.id);
          this.taskManager.complete(task.id);
          this.emit('task:completed', updatedTask);
          approved = true;
        } else if (review.decision === 'human_review') {
          hadHumanReview = true;
          this.emit('human:review_required', updatedTask, review);
          // In production: wait for human decision via webhook/callback
          // For now, auto-approve after emitting
          this.taskManager.approve(task.id);
          this.taskManager.complete(task.id);
          approved = true;
        } else {
          // Rejected — attempt rework
          this.emit('task:rejected', updatedTask, review);
          try {
            this.taskManager.rework(task.id, review.feedback);
            this.emit('task:rework', updatedTask, review);
            // Re-run with agent
            const reworkDeliverables = await agent.execute(updatedTask);
            this.taskManager.submitForReview(task.id, reworkDeliverables);
          } catch {
            // Max rework exceeded
            this.taskManager.reject(task.id, review.feedback);
            this.emit('task:failed', updatedTask, new Error('Max rework cycles exceeded'));
            approved = true; // exit loop
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.taskManager.fail(task.id, err);
      this.emit('task:failed', task, err);
    }

    return { hadHumanReview };
  }
}
