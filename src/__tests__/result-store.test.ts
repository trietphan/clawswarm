/**
 * Unit tests for ResultStore (result persistence & recovery).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ResultStore } from '../core/utils/result-store.js';
import { TaskManager } from '../core/task.js';
import type { Goal, Task } from '../core/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(dir: string): ResultStore {
  return new ResultStore(dir);
}

function makeTask(goalId = 'goal-1'): Task {
  const tm = new TaskManager();
  return tm.create({
    goalId,
    title: 'Test Task',
    description: 'Do something',
    dependsOn: [],
  });
}

function makeGoal(id = 'goal-1'): Goal {
  return {
    id,
    title: 'Test Goal',
    description: 'Do a thing',
    status: 'in_progress',
    tasks: [],
    deliverables: [],
    priority: 0,
    tags: [],
    cost: { totalTokens: 0, estimatedCostUsd: 0, byAgent: {} },
    createdAt: new Date().toISOString(),
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'clawswarm-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── ResultStore — construction ───────────────────────────────────────────────

describe('ResultStore — construction', () => {
  it('creates store directory structure on init', () => {
    makeStore(tmpDir);
    expect(existsSync(join(tmpDir, 'goals'))).toBe(true);
    expect(existsSync(join(tmpDir, 'tasks'))).toBe(true);
  });

  it('does not throw if directories already exist', () => {
    makeStore(tmpDir); // first time
    expect(() => makeStore(tmpDir)).not.toThrow(); // second time
  });
});

// ─── ResultStore — goal persistence ──────────────────────────────────────────

describe('ResultStore — goal persistence', () => {
  it('saves and loads a goal', () => {
    const store = makeStore(tmpDir);
    const goal = makeGoal('g-123');

    store.saveGoal(goal);
    const loaded = store.loadGoal('g-123');

    expect(loaded).toBeDefined();
    expect(loaded!.goal.id).toBe('g-123');
    expect(loaded!.goal.title).toBe('Test Goal');
    expect(loaded!.savedAt).toBeTruthy();
  });

  it('returns undefined for unknown goal', () => {
    const store = makeStore(tmpDir);
    expect(store.loadGoal('nonexistent')).toBeUndefined();
  });

  it('overwrites goal on second save', () => {
    const store = makeStore(tmpDir);
    const goal = makeGoal('g-update');

    store.saveGoal(goal);
    const updated = { ...goal, status: 'completed' as const };
    store.saveGoal(updated);

    const loaded = store.loadGoal('g-update');
    expect(loaded!.goal.status).toBe('completed');
  });

  it('loadAllGoals returns all saved goals', () => {
    const store = makeStore(tmpDir);
    store.saveGoal(makeGoal('g-1'));
    store.saveGoal(makeGoal('g-2'));
    store.saveGoal(makeGoal('g-3'));

    const all = store.loadAllGoals();
    expect(all).toHaveLength(3);
    expect(all.map(s => s.goal.id).sort()).toEqual(['g-1', 'g-2', 'g-3']);
  });

  it('loadAllGoals returns empty array when none saved', () => {
    const store = makeStore(tmpDir);
    expect(store.loadAllGoals()).toEqual([]);
  });

  it('deleteGoal removes the file', () => {
    const store = makeStore(tmpDir);
    store.saveGoal(makeGoal('g-del'));

    store.deleteGoal('g-del');
    expect(store.loadGoal('g-del')).toBeUndefined();
  });

  it('deleteGoal is safe when goal does not exist', () => {
    const store = makeStore(tmpDir);
    expect(() => store.deleteGoal('ghost')).not.toThrow();
  });
});

// ─── ResultStore — task persistence ──────────────────────────────────────────

describe('ResultStore — task persistence', () => {
  it('saves and loads a task', () => {
    const store = makeStore(tmpDir);
    const task = makeTask('g-1');

    store.saveTask(task);
    const loaded = store.loadTask(task.id);

    expect(loaded).toBeDefined();
    expect(loaded!.task.id).toBe(task.id);
    expect(loaded!.partial).toBe(false);
  });

  it('marks task as partial when partial=true', () => {
    const store = makeStore(tmpDir);
    const task = makeTask('g-1');

    store.saveTask(task, true);
    const loaded = store.loadTask(task.id);

    expect(loaded!.partial).toBe(true);
  });

  it('returns undefined for unknown task', () => {
    const store = makeStore(tmpDir);
    expect(store.loadTask('nonexistent')).toBeUndefined();
  });

  it('loadTasks(goalId) filters by goal', () => {
    const store = makeStore(tmpDir);
    const t1 = makeTask('goal-A');
    const t2 = makeTask('goal-A');
    const t3 = makeTask('goal-B');

    store.saveTask(t1);
    store.saveTask(t2);
    store.saveTask(t3);

    const forA = store.loadTasks('goal-A');
    expect(forA).toHaveLength(2);
    expect(forA.every(s => s.task.goalId === 'goal-A')).toBe(true);
  });

  it('loadAllTasks returns all saved tasks', () => {
    const store = makeStore(tmpDir);
    store.saveTask(makeTask('g-1'));
    store.saveTask(makeTask('g-2'));

    const all = store.loadAllTasks();
    expect(all).toHaveLength(2);
  });

  it('persists deliverables with the task', () => {
    const store = makeStore(tmpDir);
    const task = makeTask('g-1');
    task.deliverables = [{ type: 'text', label: 'Output', content: 'hello world' }];

    store.saveTask(task);
    const loaded = store.loadTask(task.id);
    expect(loaded!.task.deliverables).toHaveLength(1);
    expect(loaded!.task.deliverables[0].content).toBe('hello world');
  });

  it('deleteTask removes the file', () => {
    const store = makeStore(tmpDir);
    const task = makeTask('g-1');
    store.saveTask(task);

    store.deleteTask(task.id);
    expect(store.loadTask(task.id)).toBeUndefined();
  });
});

// ─── ResultStore — hasSavedState & clearGoal ─────────────────────────────────

describe('ResultStore — hasSavedState & clearGoal', () => {
  it('hasSavedState returns false when no goal saved', () => {
    const store = makeStore(tmpDir);
    expect(store.hasSavedState('unknown')).toBe(false);
  });

  it('hasSavedState returns true after saveGoal', () => {
    const store = makeStore(tmpDir);
    store.saveGoal(makeGoal('g-check'));
    expect(store.hasSavedState('g-check')).toBe(true);
  });

  it('clearGoal removes goal and all its tasks', () => {
    const store = makeStore(tmpDir);
    const goalId = 'g-clear';
    store.saveGoal(makeGoal(goalId));
    store.saveTask(makeTask(goalId));
    store.saveTask(makeTask(goalId));

    store.clearGoal(goalId);

    expect(store.hasSavedState(goalId)).toBe(false);
    expect(store.loadTasks(goalId)).toHaveLength(0);
  });
});

// ─── ResultStore — round-trip correctness ────────────────────────────────────

describe('ResultStore — round-trip data integrity', () => {
  it('persists reworkCount and task status correctly', () => {
    const store = makeStore(tmpDir);
    const tm = new TaskManager();
    let task = tm.create({ goalId: 'g-rt', title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.submitForReview(task.id, [{ type: 'text', label: 'Draft', content: 'v1' }]);
    tm.rework(task.id, 'needs more detail');
    task = tm.get(task.id)!;

    store.saveTask(task);
    const loaded = store.loadTask(task.id);

    expect(loaded!.task.status).toBe('rework');
    expect(loaded!.task.reworkCount).toBe(1);
  });

  it('new ResultStore instance reads files written by another instance', () => {
    const store1 = makeStore(tmpDir);
    store1.saveGoal(makeGoal('g-shared'));

    const store2 = makeStore(tmpDir);
    expect(store2.loadGoal('g-shared')).toBeDefined();
  });
});
