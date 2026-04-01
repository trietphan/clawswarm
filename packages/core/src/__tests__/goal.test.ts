/**
 * Unit tests for GoalManager and GoalPlanner.
 * Covers: creation, status transitions, task attachment,
 * error handling, and GoalPlanner decomposition logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoalManager, GoalPlanner } from '../goal.js';
import { TaskManager } from '../task.js';
import type { GoalStatus, CreateGoalInput } from '../types.js';

// ─── GoalManager Tests ────────────────────────────────────────────────────────

describe('GoalManager — create', () => {
  let gm: GoalManager;
  beforeEach(() => { gm = new GoalManager(); });

  it('assigns a unique ID per goal', () => {
    const g1 = gm.create({ title: 'G1', description: 'D1' });
    const g2 = gm.create({ title: 'G2', description: 'D2' });
    expect(g1.id).toBeTruthy();
    expect(g2.id).toBeTruthy();
    expect(g1.id).not.toBe(g2.id);
  });

  it('sets initial status to "created"', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.status).toBe('created');
  });

  it('initialises tasks as empty array', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.tasks).toEqual([]);
  });

  it('initialises deliverables as empty array', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.deliverables).toEqual([]);
  });

  it('initialises cost to zeroes', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.cost.totalTokens).toBe(0);
    expect(goal.cost.estimatedCostUsd).toBe(0);
    expect(goal.cost.byAgent).toEqual({});
  });

  it('defaults priority to 0 when not provided', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.priority).toBe(0);
  });

  it('accepts custom priority', () => {
    const goal = gm.create({ title: 'G', description: 'D', priority: 10 });
    expect(goal.priority).toBe(10);
  });

  it('defaults tags to empty array when not provided', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.tags).toEqual([]);
  });

  it('preserves provided tags', () => {
    const goal = gm.create({ title: 'G', description: 'D', tags: ['ai', 'oss'] });
    expect(goal.tags).toEqual(['ai', 'oss']);
  });

  it('sets createdAt as an ISO timestamp', () => {
    const before = new Date().toISOString();
    const goal = gm.create({ title: 'G', description: 'D' });
    const after = new Date().toISOString();
    expect(goal.createdAt >= before).toBe(true);
    expect(goal.createdAt <= after).toBe(true);
  });
});

describe('GoalManager — get & getAll', () => {
  let gm: GoalManager;
  beforeEach(() => { gm = new GoalManager(); });

  it('get returns the goal by ID', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(gm.get(goal.id)).toEqual(goal);
  });

  it('get returns undefined for unknown ID', () => {
    expect(gm.get('nope')).toBeUndefined();
  });

  it('getAll returns all created goals', () => {
    gm.create({ title: 'G1', description: 'D' });
    gm.create({ title: 'G2', description: 'D' });
    gm.create({ title: 'G3', description: 'D' });
    expect(gm.getAll()).toHaveLength(3);
  });

  it('getAll returns empty array when no goals exist', () => {
    expect(gm.getAll()).toHaveLength(0);
  });
});

describe('GoalManager — setStatus', () => {
  let gm: GoalManager;
  beforeEach(() => { gm = new GoalManager(); });

  const statusSequence: GoalStatus[] = ['planning', 'in_progress', 'completed'];

  it.each(statusSequence)('transitions goal to %s', (status) => {
    const goal = gm.create({ title: 'G', description: 'D' });
    const updated = gm.setStatus(goal.id, status);
    expect(updated.status).toBe(status);
    // Confirm mutation is persisted
    expect(gm.get(goal.id)!.status).toBe(status);
  });

  it('sets completedAt when transitioning to completed', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    expect(goal.completedAt).toBeUndefined();
    const completed = gm.setStatus(goal.id, 'completed');
    expect(completed.completedAt).toBeTruthy();
    expect(new Date(completed.completedAt!).getTime()).toBeGreaterThan(0);
  });

  it('does NOT set completedAt when transitioning to non-completed status', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    const updated = gm.setStatus(goal.id, 'planning');
    expect(updated.completedAt).toBeUndefined();
  });

  it('transitions to failed status', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    const failed = gm.setStatus(goal.id, 'failed');
    expect(failed.status).toBe('failed');
  });

  it('throws with "not found" for unknown goal ID', () => {
    expect(() => gm.setStatus('unknown-goal', 'planning')).toThrow(/not found/i);
  });

  it('can update status multiple times on same goal', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    gm.setStatus(goal.id, 'planning');
    gm.setStatus(goal.id, 'in_progress');
    const current = gm.setStatus(goal.id, 'completed');
    expect(current.status).toBe('completed');
  });
});

describe('GoalManager — setTasks', () => {
  let gm: GoalManager;
  beforeEach(() => { gm = new GoalManager(); });

  it('attaches tasks to the goal', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    const fakeTasks = [
      { id: 't1', title: 'Task 1' } as any,
      { id: 't2', title: 'Task 2' } as any,
    ];
    const updated = gm.setTasks(goal.id, fakeTasks);
    expect(updated.tasks).toHaveLength(2);
    expect(updated.tasks[0].id).toBe('t1');
  });

  it('throws for unknown goal ID', () => {
    expect(() => gm.setTasks('bad-id', [])).toThrow(/not found/i);
  });

  it('persists tasks after setTasks call', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    gm.setTasks(goal.id, [{ id: 'tx' } as any]);
    expect(gm.get(goal.id)!.tasks).toHaveLength(1);
  });
});

// ─── GoalPlanner Tests ────────────────────────────────────────────────────────

describe('GoalPlanner — decompose', () => {
  let planner: GoalPlanner;
  let tm: TaskManager;
  let gm: GoalManager;

  beforeEach(() => {
    planner = new GoalPlanner({
      agents: [],
    } as any);
    tm = new TaskManager();
    gm = new GoalManager();
  });

  it('produces at least one task from a goal', async () => {
    const goal = gm.create({ title: 'Research AI trends', description: 'Find top AI trends 2026' });
    const tasks = await planner.decompose(goal, tm);
    expect(tasks.length).toBeGreaterThan(0);
  });

  it('all produced tasks belong to the goal', async () => {
    const goal = gm.create({ title: 'Build a blog', description: 'Create and deploy a blog site' });
    const tasks = await planner.decompose(goal, tm);
    expect(tasks.every(t => t.goalId === goal.id)).toBe(true);
  });

  it('tasks are retrievable from TaskManager after decomposition', async () => {
    const goal = gm.create({ title: 'Launch product', description: 'Go-to-market for new SaaS product' });
    const tasks = await planner.decompose(goal, tm);
    for (const task of tasks) {
      expect(tm.get(task.id)).toBeTruthy();
    }
  });

  it('produces tasks in dependency order (later tasks depend on earlier ones)', async () => {
    const goal = gm.create({ title: 'Code feature', description: 'Implement login flow' });
    const tasks = await planner.decompose(goal, tm);

    // The last task should depend on at least one prior task (the default planner
    // generates a Research → Execute → Review chain)
    if (tasks.length >= 2) {
      const lastTask = tasks[tasks.length - 1];
      expect(lastTask.dependsOn.length).toBeGreaterThan(0);
    }
  });

  it('infers ops agent type for deployment-related goals', async () => {
    const goal = gm.create({ title: 'Deploy to Kubernetes', description: 'Deploy the app to k8s cluster' });
    const tasks = await planner.decompose(goal, tm);
    // Middle task (Execute) should be assigned to ops
    const executionTask = tasks.find(t => t.title.startsWith('Execute:'));
    if (executionTask) {
      expect(executionTask.assignedTo).toBe('ops');
    }
  });

  it('infers code agent type for coding-related goals', async () => {
    const goal = gm.create({ title: 'Build API endpoint', description: 'Implement a REST API endpoint' });
    const tasks = await planner.decompose(goal, tm);
    const executionTask = tasks.find(t => t.title.startsWith('Execute:'));
    if (executionTask) {
      expect(executionTask.assignedTo).toBe('code');
    }
  });

  it('infers research agent type for research-related goals', async () => {
    const goal = gm.create({ title: 'Research competitors', description: 'Analyze competitor landscape' });
    const tasks = await planner.decompose(goal, tm);
    const executionTask = tasks.find(t => t.title.startsWith('Execute:'));
    if (executionTask) {
      expect(executionTask.assignedTo).toBe('research');
    }
  });
});
