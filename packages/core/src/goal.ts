/**
 * Goal decomposition and planning.
 * @module @clawswarm/core/goal
 */

import { Goal, GoalStatus, CreateGoalInput, Task, AgentType, SwarmConfig } from './types.js';
import { TaskManager } from './task.js';

// ─── Goal Planner ─────────────────────────────────────────────────────────────

/**
 * Decomposes high-level goals into concrete, assignable tasks.
 *
 * The Planner analyzes a goal description and generates a task plan,
 * assigns each task to the appropriate specialist agent, and sequences
 * tasks based on their dependencies.
 *
 * @example
 * ```typescript
 * const planner = new GoalPlanner(swarmConfig);
 * const tasks = await planner.decompose(goal, taskManager);
 * ```
 */
export class GoalPlanner {
  constructor(private readonly config: SwarmConfig) {}

  /**
   * Decompose a goal into a list of tasks.
   * Creates tasks via the TaskManager and returns them in execution order.
   */
  async decompose(goal: Goal, taskManager: TaskManager): Promise<Task[]> {
    const plan = await this._generatePlan(goal);
    const tasks: Task[] = [];

    // Create tasks from plan (maintaining dependency ordering)
    for (const step of plan) {
      const task = taskManager.create({
        goalId: goal.id,
        title: step.title,
        description: step.description,
        assignedTo: step.agentType,
        dependsOn: step.dependsOnTitles
          ? tasks
            .filter(t => step.dependsOnTitles!.includes(t.title))
            .map(t => t.id)
          : [],
      });
      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Generate a task plan for a goal.
   * In production, this calls an LLM with the planner system prompt.
   * Returns structured step definitions.
   */
  private async _generatePlan(goal: Goal): Promise<PlanStep[]> {
    // TODO: Replace with actual LLM call
    // This stub returns a basic 3-step plan as an example
    return [
      {
        title: `Research: ${goal.title}`,
        description: `Research and gather background information for: ${goal.description}`,
        agentType: 'research' as AgentType,
      },
      {
        title: `Execute: ${goal.title}`,
        description: `Based on research, implement the core work for: ${goal.description}`,
        agentType: this._inferPrimaryAgent(goal),
        dependsOnTitles: [`Research: ${goal.title}`],
      },
      {
        title: `Review: ${goal.title}`,
        description: `Verify and validate the output for: ${goal.description}`,
        agentType: 'research' as AgentType,
        dependsOnTitles: [`Execute: ${goal.title}`],
      },
    ];
  }

  /**
   * Infer the primary execution agent type from the goal description.
   */
  private _inferPrimaryAgent(goal: Goal): AgentType {
    const desc = `${goal.title} ${goal.description}`.toLowerCase();

    if (/deploy|infrastructure|k8s|docker|ci\/cd|monitoring|server/.test(desc)) {
      return 'ops';
    }
    if (/code|build|implement|function|api|test|debug|refactor/.test(desc)) {
      return 'code';
    }
    if (/research|analyze|report|summarize|find|investigate/.test(desc)) {
      return 'research';
    }

    return 'code'; // default
  }
}

// ─── Goal Manager ─────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of goals in a ClawSwarm instance.
 */
export class GoalManager {
  private goals: Map<string, Goal> = new Map();

  /**
   * Create a new goal.
   */
  create(input: CreateGoalInput): Goal {
    const goal: Goal = {
      ...input,
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'created',
      tasks: [],
      deliverables: [],
      priority: input.priority ?? 0,
      tags: input.tags ?? [],
      cost: {
        totalTokens: 0,
        estimatedCostUsd: 0,
        byAgent: {},
      },
      createdAt: new Date().toISOString(),
    };
    this.goals.set(goal.id, goal);
    return goal;
  }

  /**
   * Get a goal by ID.
   */
  get(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * Get all goals.
   */
  getAll(): Goal[] {
    return Array.from(this.goals.values());
  }

  /**
   * Update a goal's status.
   */
  setStatus(goalId: string, status: GoalStatus): Goal {
    const goal = this._getOrThrow(goalId);
    goal.status = status;
    if (status === 'completed') {
      goal.completedAt = new Date().toISOString();
    }
    return goal;
  }

  /**
   * Attach tasks to a goal.
   */
  setTasks(goalId: string, tasks: Goal['tasks']): Goal {
    const goal = this._getOrThrow(goalId);
    goal.tasks = tasks;
    return goal;
  }

  private _getOrThrow(goalId: string): Goal {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal not found: ${goalId}`);
    return goal;
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface PlanStep {
  title: string;
  description: string;
  agentType: AgentType;
  dependsOnTitles?: string[];
}
