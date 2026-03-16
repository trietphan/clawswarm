/**
 * Task lifecycle management.
 * @module @clawswarm/core/task
 */

import { Task, TaskStatus, AgentType, Deliverable } from './types.js';

// ─── Task Manager ─────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of tasks within a goal.
 * Handles state transitions, rework cycles, and deliverable collection.
 *
 * @example
 * ```typescript
 * const manager = new TaskManager();
 * const task = manager.create({
 *   goalId: 'goal-123',
 *   title: 'Research AI trends',
 *   description: 'Find the top 5 AI trends in 2026',
 *   assignedTo: 'research',
 * });
 *
 * manager.start(task.id);
 * manager.complete(task.id, [{ type: 'text', label: 'Report', content: '...' }]);
 * ```
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  /**
   * Create a new task.
   */
  create(input: Omit<Task, 'id' | 'status' | 'deliverables' | 'reworkCount' | 'maxReworkCycles' | 'createdAt' | 'updatedAt'>): Task {
    const task: Task = {
      ...input,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'pending',
      deliverables: [],
      reworkCount: 0,
      maxReworkCycles: 3,
      dependsOn: input.dependsOn ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks.
   */
  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by goal ID.
   */
  getByGoal(goalId: string): Task[] {
    return this.getAll().filter(t => t.goalId === goalId);
  }

  /**
   * Get tasks that are ready to run (all dependencies completed).
   */
  getReady(goalId: string): Task[] {
    const tasks = this.getByGoal(goalId);
    const completedIds = new Set(
      tasks.filter(t => t.status === 'completed').map(t => t.id)
    );

    return tasks.filter(t =>
      t.status === 'pending' &&
      t.dependsOn.every(depId => completedIds.has(depId))
    );
  }

  /**
   * Assign a task to an agent type.
   */
  assign(taskId: string, agentType: AgentType): Task {
    return this._transition(taskId, 'assigned', task => {
      task.assignedTo = agentType;
    });
  }

  /**
   * Mark a task as in progress.
   */
  start(taskId: string): Task {
    return this._transition(taskId, 'in_progress');
  }

  /**
   * Submit a task for review with its deliverables.
   */
  submitForReview(taskId: string, deliverables: Deliverable[]): Task {
    return this._transition(taskId, 'review', task => {
      task.deliverables = deliverables;
    });
  }

  /**
   * Mark a task as approved.
   */
  approve(taskId: string): Task {
    return this._transition(taskId, 'approved');
  }

  /**
   * Mark a task as completed (after approval and any post-processing).
   */
  complete(taskId: string): Task {
    return this._transition(taskId, 'completed');
  }

  /**
   * Mark a task for rework. Increments rework counter.
   * @throws If max rework cycles exceeded
   */
  rework(taskId: string, feedback: string): Task {
    const task = this._getOrThrow(taskId);

    if (task.reworkCount >= task.maxReworkCycles) {
      throw new Error(
        `Task ${taskId} has exceeded max rework cycles (${task.maxReworkCycles}). Failing task.`
      );
    }

    return this._transition(taskId, 'rework', t => {
      t.reworkCount += 1;
      // Store feedback as a note in deliverables for the agent to reference
      t.deliverables = [
        ...t.deliverables,
        {
          type: 'text',
          label: `Rework Feedback (Cycle ${t.reworkCount})`,
          content: feedback,
        },
      ];
    });
  }

  /**
   * Mark a task as rejected (max rework exceeded or explicitly rejected).
   */
  reject(taskId: string, reason: string): Task {
    return this._transition(taskId, 'rejected', task => {
      task.deliverables = [
        ...task.deliverables,
        { type: 'text', label: 'Rejection Reason', content: reason },
      ];
    });
  }

  /**
   * Mark a task as failed (unexpected error).
   */
  fail(taskId: string, error: Error): Task {
    return this._transition(taskId, 'failed', task => {
      task.deliverables = [
        ...task.deliverables,
        { type: 'text', label: 'Error', content: error.message },
      ];
    });
  }

  /**
   * Check if a goal has all tasks completed or failed.
   */
  isGoalDone(goalId: string): boolean {
    const tasks = this.getByGoal(goalId);
    if (tasks.length === 0) return false;
    return tasks.every(t => t.status === 'completed' || t.status === 'failed' || t.status === 'rejected');
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _transition(
    taskId: string,
    status: TaskStatus,
    mutate?: (task: Task) => void
  ): Task {
    const task = this._getOrThrow(taskId);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    mutate?.(task);
    return task;
  }

  private _getOrThrow(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }
}
