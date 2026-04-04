/**
 * Result Persistence & Recovery — persists task/goal state to disk so that
 * a restarted bridge can resume from last known state instead of starting over.
 *
 * Storage layout (under `storeDir`):
 *   <storeDir>/
 *     goals/<goalId>.json   — Goal snapshot
 *     tasks/<taskId>.json   — Task snapshot (including partial deliverables)
 *
 * @module @clawswarm/core/utils/result-store
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Goal, Task } from '../types.js';

export interface PersistedTaskState {
  task: Task;
  savedAt: string;
  /** true when execution was in-flight at save time (partial output possible) */
  partial: boolean;
}

export interface PersistedGoalState {
  goal: Goal;
  savedAt: string;
}

/**
 * Simple file-based result store.
 * Thread-safe only for a single process; do not use across concurrent Node
 * processes without an external lock.
 *
 * @example
 * ```typescript
 * const store = new ResultStore('/tmp/clawswarm-state');
 *
 * // Persist after every task update
 * store.saveTask(task);
 *
 * // On restart: load all tasks for a goal
 * const savedTasks = store.loadTasks(goalId);
 * if (savedTasks.length > 0) {
 *   console.log('Resuming from', savedTasks.length, 'saved tasks');
 * }
 * ```
 */
export class ResultStore {
  private readonly goalsDir: string;
  private readonly tasksDir: string;

  constructor(storeDir: string) {
    this.goalsDir = join(storeDir, 'goals');
    this.tasksDir = join(storeDir, 'tasks');
    this._ensureDirs();
  }

  // ─── Goal persistence ─────────────────────────────────────────────────────

  /**
   * Persist a goal snapshot to disk.
   */
  saveGoal(goal: Goal): void {
    const state: PersistedGoalState = {
      goal,
      savedAt: new Date().toISOString(),
    };
    this._write(this.goalsDir, `${goal.id}.json`, state);
  }

  /**
   * Load a previously saved goal, or undefined if not found.
   */
  loadGoal(goalId: string): PersistedGoalState | undefined {
    return this._read<PersistedGoalState>(this.goalsDir, `${goalId}.json`);
  }

  /**
   * Load all saved goals.
   */
  loadAllGoals(): PersistedGoalState[] {
    return this._readAll<PersistedGoalState>(this.goalsDir);
  }

  /**
   * Delete a persisted goal (called after final completion/cleanup).
   */
  deleteGoal(goalId: string): void {
    this._delete(this.goalsDir, `${goalId}.json`);
  }

  // ─── Task persistence ─────────────────────────────────────────────────────

  /**
   * Persist a task snapshot to disk.
   * @param partial - Mark as in-flight (partial output) when true
   */
  saveTask(task: Task, partial = false): void {
    const state: PersistedTaskState = {
      task,
      savedAt: new Date().toISOString(),
      partial,
    };
    this._write(this.tasksDir, `${task.id}.json`, state);
  }

  /**
   * Load a previously saved task, or undefined if not found.
   */
  loadTask(taskId: string): PersistedTaskState | undefined {
    return this._read<PersistedTaskState>(this.tasksDir, `${taskId}.json`);
  }

  /**
   * Load all saved tasks for a specific goal.
   */
  loadTasks(goalId: string): PersistedTaskState[] {
    return this._readAll<PersistedTaskState>(this.tasksDir).filter(
      s => s.task.goalId === goalId
    );
  }

  /**
   * Load all saved tasks (all goals).
   */
  loadAllTasks(): PersistedTaskState[] {
    return this._readAll<PersistedTaskState>(this.tasksDir);
  }

  /**
   * Delete a persisted task.
   */
  deleteTask(taskId: string): void {
    this._delete(this.tasksDir, `${taskId}.json`);
  }

  /**
   * Check whether a goal has any saved state (for resume detection).
   */
  hasSavedState(goalId: string): boolean {
    const goalFile = join(this.goalsDir, `${goalId}.json`);
    return existsSync(goalFile);
  }

  /**
   * Wipe all state for a goal (goals + its tasks).
   * Call after successful completion.
   */
  clearGoal(goalId: string): void {
    this.deleteGoal(goalId);
    const tasks = this.loadTasks(goalId);
    for (const { task } of tasks) {
      this.deleteTask(task.id);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _ensureDirs(): void {
    for (const dir of [this.goalsDir, this.tasksDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private _write(dir: string, filename: string, data: unknown): void {
    const path = join(dir, filename);
    try {
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      // Non-fatal: persistence failures should not crash the pipeline
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ResultStore] Failed to write ${path}: ${msg}`);
    }
  }

  private _read<T>(dir: string, filename: string): T | undefined {
    const path = join(dir, filename);
    try {
      if (!existsSync(path)) return undefined;
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ResultStore] Failed to read ${path}: ${msg}`);
      return undefined;
    }
  }

  private _readAll<T>(dir: string): T[] {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      const results: T[] = [];
      for (const file of files) {
        const item = this._read<T>(dir, file);
        if (item !== undefined) results.push(item);
      }
      return results;
    } catch {
      return [];
    }
  }

  private _delete(dir: string, filename: string): void {
    const path = join(dir, filename);
    try {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ResultStore] Failed to delete ${path}: ${msg}`);
    }
  }
}
