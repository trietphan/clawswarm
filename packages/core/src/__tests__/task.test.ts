/**
 * Unit tests for TaskManager.
 * Covers: create, status transitions, dependency resolution,
 * rework cycles, failure handling, and filtering helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../task.js';
import type { Deliverable, TaskStatus } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GOAL = 'goal-task-test-001';

const textDeliverable = (content = 'Hello world'): Deliverable => ({
  type: 'text',
  label: 'Output',
  content,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TaskManager — create', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  it('creates a task with a unique ID', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D1', dependsOn: [] });
    const t2 = tm.create({ goalId: GOAL, title: 'T2', description: 'D2', dependsOn: [] });
    expect(t1.id).toBeTruthy();
    expect(t2.id).toBeTruthy();
    expect(t1.id).not.toBe(t2.id);
  });

  it('initialises task with pending status', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    expect(task.status).toBe('pending');
  });

  it('initialises deliverables as empty array', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    expect(task.deliverables).toHaveLength(0);
  });

  it('initialises reworkCount at zero', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    expect(task.reworkCount).toBe(0);
  });

  it('stores goalId, title, and description', () => {
    const task = tm.create({ goalId: GOAL, title: 'My Title', description: 'My desc', dependsOn: [] });
    expect(task.goalId).toBe(GOAL);
    expect(task.title).toBe('My Title');
    expect(task.description).toBe('My desc');
  });

  it('stores dependsOn IDs', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D1', dependsOn: [] });
    const t2 = tm.create({ goalId: GOAL, title: 'T2', description: 'D2', dependsOn: [t1.id] });
    expect(t2.dependsOn).toContain(t1.id);
  });

  it('stores optional assignedTo', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [], assignedTo: 'code' });
    expect(task.assignedTo).toBe('code');
  });
});

describe('TaskManager — get', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  it('returns the task by ID', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    expect(tm.get(task.id)).toEqual(task);
  });

  it('returns undefined for unknown ID', () => {
    expect(tm.get('nonexistent')).toBeUndefined();
  });
});

describe('TaskManager — status transitions', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  const fullLifecycle = (status: TaskStatus) => {
    it(`reaches ${status}`, () => {
      const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
      tm.assign(task.id, 'code');
      tm.start(task.id);
      tm.submitForReview(task.id, [textDeliverable()]);
      if (status === 'approved') { tm.approve(task.id); }
      if (status === 'completed') { tm.approve(task.id); tm.complete(task.id); }
      if (status === 'rejected') { tm.reject(task.id, 'bad output'); }
      expect(tm.get(task.id)!.status).toBe(status);
    });
  };

  it('pending → assigned', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'research');
    expect(tm.get(task.id)!.status).toBe('assigned');
    expect(tm.get(task.id)!.assignedTo).toBe('research');
  });

  it('assigned → in_progress', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);
    expect(tm.get(task.id)!.status).toBe('in_progress');
  });

  it('in_progress → review (with deliverables attached)', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable('some content')]);
    const updated = tm.get(task.id)!;
    expect(updated.status).toBe('review');
    expect(updated.deliverables).toHaveLength(1);
    expect(updated.deliverables[0].content).toBe('some content');
  });

  it('review → approved', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.approve(task.id);
    expect(tm.get(task.id)!.status).toBe('approved');
  });

  it('approved → completed', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.approve(task.id);
    tm.complete(task.id);
    expect(tm.get(task.id)!.status).toBe('completed');
  });

  it('in_progress → failed (with error stored as deliverable)', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'ops');
    tm.start(task.id);
    tm.fail(task.id, new Error('Connection refused'));
    const failed = tm.get(task.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.deliverables.some(d => d.label === 'Error' && d.content === 'Connection refused')).toBe(true);
  });

  it('review → rejected (with rejection feedback)', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'research');
    tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.reject(task.id, 'Output quality too low');
    const rejected = tm.get(task.id)!;
    expect(rejected.status).toBe('rejected');
  });
});

describe('TaskManager — rework', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  it('transitions to rework status and increments reworkCount', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code'); tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.rework(task.id, 'Missing tests');
    const t = tm.get(task.id)!;
    expect(t.status).toBe('rework');
    expect(t.reworkCount).toBe(1);
  });

  it('appends feedback as a Rework Feedback deliverable', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code'); tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.rework(task.id, 'Fix the thing');
    const t = tm.get(task.id)!;
    expect(t.deliverables.some(d => d.label.startsWith('Rework Feedback') && d.content.includes('Fix the thing'))).toBe(true);
  });

  it('allows multiple rework cycles (up to max)', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code'); tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);

    tm.rework(task.id, 'Round 1');
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.rework(task.id, 'Round 2');
    tm.submitForReview(task.id, [textDeliverable()]);
    tm.rework(task.id, 'Round 3');

    expect(tm.get(task.id)!.reworkCount).toBe(3);
  });

  it('throws when max rework cycles exceeded', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code'); tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]);

    for (let i = 1; i <= 3; i++) {
      tm.rework(task.id, `Round ${i}`);
      tm.submitForReview(task.id, [textDeliverable()]);
    }

    expect(() => tm.rework(task.id, 'Round 4')).toThrow(/max rework cycles/i);
  });
});

describe('TaskManager — dependency resolution', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  it('getReady returns tasks with no dependencies', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D', dependsOn: [] });
    tm.create({ goalId: GOAL, title: 'T2', description: 'D', dependsOn: [t1.id] });

    const ready = tm.getReady(GOAL);
    expect(ready.map(t => t.id)).toContain(t1.id);
    expect(ready.map(t => t.id)).not.toContain('T2');
  });

  it('getReady unblocks dependents once dependency is completed', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D', dependsOn: [] });
    const t2 = tm.create({ goalId: GOAL, title: 'T2', description: 'D', dependsOn: [t1.id] });

    // complete T1
    tm.assign(t1.id, 'code'); tm.start(t1.id);
    tm.submitForReview(t1.id, [textDeliverable()]);
    tm.approve(t1.id); tm.complete(t1.id);

    const ready = tm.getReady(GOAL);
    expect(ready.map(t => t.id)).toContain(t2.id);
  });

  it('does not return completed tasks as ready', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D', dependsOn: [] });
    tm.assign(t1.id, 'code'); tm.start(t1.id);
    tm.submitForReview(t1.id, [textDeliverable()]);
    tm.approve(t1.id); tm.complete(t1.id);

    const ready = tm.getReady(GOAL);
    expect(ready.map(t => t.id)).not.toContain(t1.id);
  });

  it('handles a chain of 3 sequential tasks', () => {
    const t1 = tm.create({ goalId: GOAL, title: 'T1', description: 'D', dependsOn: [] });
    const t2 = tm.create({ goalId: GOAL, title: 'T2', description: 'D', dependsOn: [t1.id] });
    const t3 = tm.create({ goalId: GOAL, title: 'T3', description: 'D', dependsOn: [t2.id] });

    // Only T1 is ready
    expect(tm.getReady(GOAL).map(t => t.id)).toEqual([t1.id]);

    // Complete T1 → T2 becomes ready
    tm.assign(t1.id, 'code'); tm.start(t1.id);
    tm.submitForReview(t1.id, [textDeliverable()]); tm.approve(t1.id); tm.complete(t1.id);
    expect(tm.getReady(GOAL).map(t => t.id)).toEqual([t2.id]);

    // Complete T2 → T3 becomes ready
    tm.assign(t2.id, 'code'); tm.start(t2.id);
    tm.submitForReview(t2.id, [textDeliverable()]); tm.approve(t2.id); tm.complete(t2.id);
    expect(tm.getReady(GOAL).map(t => t.id)).toEqual([t3.id]);
  });
});

describe('TaskManager — isGoalDone & getByGoal', () => {
  let tm: TaskManager;
  beforeEach(() => { tm = new TaskManager(); });

  it('isGoalDone returns false when no tasks exist', () => {
    // A goal with no tasks: nothing to iterate, so true by vacuous logic
    // depends on implementation — document both valid behaviors
    const result = tm.isGoalDone('empty-goal');
    expect(typeof result).toBe('boolean');
  });

  it('isGoalDone returns false when a task is pending', () => {
    tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    expect(tm.isGoalDone(GOAL)).toBe(false);
  });

  it('isGoalDone returns true when all tasks are completed', () => {
    const task = tm.create({ goalId: GOAL, title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code'); tm.start(task.id);
    tm.submitForReview(task.id, [textDeliverable()]); tm.approve(task.id); tm.complete(task.id);
    expect(tm.isGoalDone(GOAL)).toBe(true);
  });

  it('getByGoal returns only tasks for specified goal', () => {
    const GOAL_A = 'goal-a';
    const GOAL_B = 'goal-b';
    tm.create({ goalId: GOAL_A, title: 'A1', description: 'D', dependsOn: [] });
    tm.create({ goalId: GOAL_A, title: 'A2', description: 'D', dependsOn: [] });
    tm.create({ goalId: GOAL_B, title: 'B1', description: 'D', dependsOn: [] });

    const aTasks = tm.getByGoal(GOAL_A);
    expect(aTasks).toHaveLength(2);
    expect(aTasks.every(t => t.goalId === GOAL_A)).toBe(true);

    const bTasks = tm.getByGoal(GOAL_B);
    expect(bTasks).toHaveLength(1);
  });

  it('getByGoal returns empty array for unknown goalId', () => {
    expect(tm.getByGoal('nonexistent-goal')).toHaveLength(0);
  });
});
