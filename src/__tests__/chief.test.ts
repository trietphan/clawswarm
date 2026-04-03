/**
 * Unit tests for ChiefReviewer.
 * Covers: scoring thresholds, decision logic, review of tasks
 * with various deliverable qualities, rework cycle handling,
 * config validation, and event emission.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChiefReviewer } from '../core/chief.js';
import { TaskManager } from '../core/task.js';
import type { Task, Deliverable } from '../core/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReviewer(opts: { auto?: number; human?: number } = {}): ChiefReviewer {
  return new ChiefReviewer({
    autoApproveThreshold: opts.auto ?? 8,
    humanReviewThreshold: opts.human ?? 5,
    reviewerModel: 'claude-sonnet-4',
  });
}

function makeTask(deliverables: Deliverable[], goalId = 'chief-goal'): Task {
  const tm = new TaskManager();
  const task = tm.create({ goalId, title: 'Test Task', description: 'Review me', dependsOn: [] });
  tm.assign(task.id, 'code');
  tm.start(task.id);
  tm.submitForReview(task.id, deliverables);
  return tm.get(task.id)!;
}

const richContent = 'This is a comprehensive, production-ready analysis of the subject matter. '.repeat(10);
const codeContent = 'function hello() { return "world"; }\n'.repeat(20);
const todoContent = 'TODO: implement this. FIXME: broken. Placeholder for future work.';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ChiefReviewer — construction & config validation', () => {
  it('stores config accessible via .config getter', () => {
    const reviewer = new ChiefReviewer({
      autoApproveThreshold: 9,
      humanReviewThreshold: 6,
      reviewerModel: 'claude-opus-4',
    });
    expect(reviewer.config.autoApproveThreshold).toBe(9);
    expect(reviewer.config.humanReviewThreshold).toBe(6);
    expect(reviewer.config.reviewerModel).toBe('claude-opus-4');
  });

  it('uses default thresholds when config omitted', () => {
    const reviewer = new ChiefReviewer();
    expect(reviewer.config.autoApproveThreshold).toBe(8);
    expect(reviewer.config.humanReviewThreshold).toBe(5);
  });

  it('uses default criteria when not provided', () => {
    const reviewer = new ChiefReviewer();
    expect(reviewer.config.criteria.length).toBeGreaterThan(0);
  });

  it('stores custom criteria', () => {
    const criteria = ['completeness', 'accuracy', 'safety'];
    const reviewer = new ChiefReviewer({ criteria });
    expect(reviewer.config.criteria).toEqual(criteria);
  });

  it('throws when autoApproveThreshold < humanReviewThreshold', () => {
    expect(() => new ChiefReviewer({
      autoApproveThreshold: 4,
      humanReviewThreshold: 7,
    })).toThrow();
  });

  it('throws when autoApproveThreshold > 10', () => {
    expect(() => new ChiefReviewer({
      autoApproveThreshold: 11,
      humanReviewThreshold: 5,
    })).toThrow();
  });

  it('throws when humanReviewThreshold < 0', () => {
    expect(() => new ChiefReviewer({
      autoApproveThreshold: 8,
      humanReviewThreshold: -1,
    })).toThrow();
  });

  it('allows equal autoApprove and humanReview thresholds', () => {
    // same threshold: anything below = rejected, at or above = approved
    expect(() => new ChiefReviewer({
      autoApproveThreshold: 7,
      humanReviewThreshold: 7,
    })).not.toThrow();
  });
});

describe('ChiefReviewer — scoreToDecision()', () => {
  it('returns "approved" for scores >= autoApproveThreshold (8)', () => {
    const r = makeReviewer();
    expect(r.scoreToDecision(8)).toBe('approved');
    expect(r.scoreToDecision(9)).toBe('approved');
    expect(r.scoreToDecision(10)).toBe('approved');
  });

  it('returns "human_review" for scores in [5, 7]', () => {
    const r = makeReviewer();
    expect(r.scoreToDecision(5)).toBe('human_review');
    expect(r.scoreToDecision(6)).toBe('human_review');
    expect(r.scoreToDecision(7)).toBe('human_review');
  });

  it('returns "rejected" for scores < humanReviewThreshold (5)', () => {
    const r = makeReviewer();
    expect(r.scoreToDecision(4)).toBe('rejected');
    expect(r.scoreToDecision(3)).toBe('rejected');
    expect(r.scoreToDecision(2)).toBe('rejected');
    expect(r.scoreToDecision(1)).toBe('rejected');
    expect(r.scoreToDecision(0)).toBe('rejected');
  });

  it('boundary: score exactly at autoApproveThreshold → approved', () => {
    const r = new ChiefReviewer({ autoApproveThreshold: 7, humanReviewThreshold: 4 });
    expect(r.scoreToDecision(7)).toBe('approved');
    expect(r.scoreToDecision(6)).toBe('human_review');
  });

  it('boundary: score exactly at humanReviewThreshold → human_review', () => {
    const r = makeReviewer();
    expect(r.scoreToDecision(5)).toBe('human_review');
    expect(r.scoreToDecision(4)).toBe('rejected');
  });

  it('custom thresholds: auto=10, human=8', () => {
    const r = new ChiefReviewer({ autoApproveThreshold: 10, humanReviewThreshold: 8 });
    expect(r.scoreToDecision(10)).toBe('approved');
    expect(r.scoreToDecision(9)).toBe('human_review');
    expect(r.scoreToDecision(8)).toBe('human_review');
    expect(r.scoreToDecision(7)).toBe('rejected');
  });
});

describe('ChiefReviewer — review()', () => {
  it('auto-rejects task with no deliverables (score=0)', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([]);
    const result = await reviewer.review(task);
    expect(result.score).toBe(0);
    expect(result.decision).toBe('rejected');
    expect(result.taskId).toBe(task.id);
  });

  it('returns a valid ReviewResult shape', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([{ type: 'text', label: 'Output', content: richContent }]);
    const result = await reviewer.review(task);

    expect(result.taskId).toBe(task.id);
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(['approved', 'human_review', 'rejected']).toContain(result.decision);
    expect(typeof result.feedback).toBe('string');
    expect(Array.isArray(result.issues)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(result.reviewedAt).toBeTruthy();
  });

  it('flags TODO/FIXME content as an issue', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([{ type: 'text', label: 'Draft', content: todoContent }]);
    const result = await reviewer.review(task);
    expect(result.issues.some(i => /TODO|FIXME|placeholder/i.test(i))).toBe(true);
  });

  it('assigns higher score to rich code content vs short content', async () => {
    const reviewer = makeReviewer();

    const richTask = makeTask([{ type: 'code', label: 'Code', content: codeContent }]);
    const poorTask = makeTask([{ type: 'text', label: 'Output', content: 'hi' }]);

    const richResult = await reviewer.review(richTask);
    const poorResult = await reviewer.review(poorTask);

    // Rich task should score at least as high as poor task
    expect(richResult.score).toBeGreaterThanOrEqual(poorResult.score);
  });

  it('emits "reviewed" event after completing a review', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([{ type: 'text', label: 'Output', content: richContent }]);

    const emittedResults: any[] = [];
    reviewer.on('reviewed', (result) => emittedResults.push(result));

    await reviewer.review(task);
    expect(emittedResults).toHaveLength(1);
    expect(emittedResults[0].taskId).toBe(task.id);
  });

  it('score is clamped between 0 and 10', async () => {
    const reviewer = makeReviewer();
    const tasks = [
      makeTask([]),
      makeTask([{ type: 'text', label: 'O', content: richContent }]),
      makeTask([{ type: 'code', label: 'C', content: codeContent }]),
    ];

    for (const task of tasks) {
      const result = await reviewer.review(task);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(10);
    }
  });
});

describe('ChiefReviewer — rework cycle simulation', () => {
  it('reviewer gives no issues for clean, rich deliverables', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([
      { type: 'code', label: 'Implementation', content: codeContent },
    ]);
    const result = await reviewer.review(task);

    if (result.decision === 'approved') {
      expect(result.issues).toHaveLength(0);
    }
  });

  it('consecutive reviews of the same task return the same decision for same content', async () => {
    const reviewer = makeReviewer();
    const task = makeTask([{ type: 'text', label: 'Output', content: richContent }]);

    const r1 = await reviewer.review(task);
    const r2 = await reviewer.review(task);

    // Same task, same content → same decision
    expect(r1.decision).toBe(r2.decision);
    expect(r1.score).toBe(r2.score);
  });

  it('reviewer correctly routes through full rework cycle via TaskManager', async () => {
    const reviewer = makeReviewer();
    const tm = new TaskManager();

    const task = tm.create({ goalId: 'rework-goal', title: 'T', description: 'D', dependsOn: [] });
    tm.assign(task.id, 'code');
    tm.start(task.id);

    // First submission: empty → rejected
    tm.submitForReview(task.id, []);
    const firstReview = await reviewer.review(tm.get(task.id)!);
    expect(firstReview.decision).toBe('rejected');

    // Rework cycle
    tm.rework(task.id, firstReview.feedback);
    expect(tm.get(task.id)!.reworkCount).toBe(1);

    // Second submission: rich content
    tm.submitForReview(task.id, [{ type: 'text', label: 'Output', content: richContent }]);
    const secondReview = await reviewer.review(tm.get(task.id)!);

    // Rich content should score better
    expect(secondReview.score).toBeGreaterThan(firstReview.score);
  });

  it('decision matches scoreToDecision for any reviewed score', async () => {
    const reviewer = makeReviewer();
    const deliverableSets: Deliverable[][] = [
      [],
      [{ type: 'text', label: 'Short', content: 'hello' }],
      [{ type: 'text', label: 'Medium', content: richContent }],
      [{ type: 'code', label: 'Code', content: codeContent }],
      [{ type: 'text', label: 'Todo', content: todoContent }],
    ];

    for (const deliverables of deliverableSets) {
      const task = makeTask(deliverables);
      const result = await reviewer.review(task);
      const expectedDecision = reviewer.scoreToDecision(result.score);
      expect(result.decision).toBe(expectedDecision);
    }
  });
});
