/**
 * Chief Review Example — ClawSwarm
 *
 * Demonstrates how to customize the chief review pipeline:
 * - Custom scoring thresholds
 * - Custom review criteria
 * - Listening to review events
 * - Handling human-review-required tasks
 * - Using a stricter reviewer model
 *
 * Run:
 *   npx tsx examples/chief-review/index.ts
 */

import { ClawSwarm, Agent, ChiefReviewer, Task, ReviewResult } from '@clawswarm/core';

// ─── Custom Review Handler ────────────────────────────────────────────────────

/**
 * A simple human review queue that collects tasks needing manual approval.
 * In a real app, this would send a Slack message, open a Jira ticket, etc.
 */
class HumanReviewQueue {
  private queue: Array<{ task: Task; review: ReviewResult }> = [];

  push(task: Task, review: ReviewResult): void {
    this.queue.push({ task, review });
    console.log(`\n  📥 Added to human review queue: "${task.title}"`);
    console.log(`     Score: ${review.score}/10`);
    console.log(`     Issues: ${review.issues.length}`);
    if (review.issues.length > 0) {
      for (const issue of review.issues) {
        console.log(`       • ${issue}`);
      }
    }
  }

  getAll(): Array<{ task: Task; review: ReviewResult }> {
    return this.queue;
  }

  size(): number {
    return this.queue.length;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const humanQueue = new HumanReviewQueue();

  // ── Scenario 1: Strict review (high thresholds) ──────────────────────────

  console.log('\n══ Scenario 1: Strict Review (threshold=9) ══\n');

  const strictSwarm = new ClawSwarm({
    agents: [
      Agent.research({ model: 'claude-sonnet-4' }),
      Agent.code({ model: 'gpt-4o' }),
    ],
    chiefReview: {
      autoApproveThreshold: 9,   // Very strict: need 9/10 to auto-approve
      humanReviewThreshold: 7,   // 7-8 → human review
      reviewerModel: 'claude-opus-4',
      criteria: [
        'correctness: Is every factual claim accurate?',
        'completeness: Are all requirements met?',
        'citations: Are all sources cited?',
        'format: Is the output properly formatted?',
        'safety: Is the content safe and appropriate?',
      ],
    },
  });

  strictSwarm.on('task:review', (task, review) => {
    const icon = { approved: '✅', human_review: '👀', rejected: '❌' }[review.decision];
    console.log(`  ${icon} "${task.title}" — ${review.score}/10 (${review.decision})`);
  });

  strictSwarm.on('human:review_required', (task, review) => {
    humanQueue.push(task, review);
  });

  strictSwarm.on('task:rework', (task, review) => {
    console.log(`  🔄 Rework #${task.reworkCount}: ${review.feedback.slice(0, 80)}...`);
  });

  const strictGoal = strictSwarm.createGoal({
    title: 'Write a technical deep-dive on WebAssembly security',
    description: 'Produce a comprehensive, citation-heavy technical article on WebAssembly security considerations in 2026. Must include at least 5 recent CVEs.',
    tags: ['research', 'security'],
  });

  await strictSwarm.execute(strictGoal);

  // ── Scenario 2: Lenient review (low thresholds) ──────────────────────────

  console.log('\n══ Scenario 2: Lenient Review (threshold=6) ══\n');

  const lenientSwarm = new ClawSwarm({
    agents: [Agent.code({ model: 'gpt-4o-mini' })],
    chiefReview: {
      autoApproveThreshold: 6,
      humanReviewThreshold: 3,
    },
  });

  lenientSwarm.on('task:review', (task, review) => {
    const icon = { approved: '✅', human_review: '👀', rejected: '❌' }[review.decision];
    console.log(`  ${icon} "${task.title}" — ${review.score}/10 (${review.decision})`);
  });

  const lenientGoal = lenientSwarm.createGoal({
    title: 'Write a basic hello world in Rust',
    description: 'Write a simple Rust program that prints "Hello, world!" and exits cleanly.',
  });

  await lenientSwarm.execute(lenientGoal);

  // ── Scenario 3: Standalone ChiefReviewer ────────────────────────────────

  console.log('\n══ Scenario 3: Standalone ChiefReviewer ══\n');

  const reviewer = new ChiefReviewer({
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
  });

  // Demonstrate the score → decision mapping
  console.log('  Score thresholds:');
  for (const score of [10, 9, 8, 7, 6, 5, 4, 3, 0]) {
    const decision = reviewer.scoreToDecision(score);
    const icon = { approved: '✅', human_review: '👀', rejected: '❌' }[decision];
    console.log(`    ${String(score).padStart(2)}/10 → ${icon} ${decision}`);
  }

  console.log(`\n  Reviewer config: ${JSON.stringify(reviewer.config, null, 2)}`);

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n══ Summary ══\n');
  console.log(`  Tasks requiring human review: ${humanQueue.size()}`);

  if (humanQueue.size() > 0) {
    console.log('\n  Human Review Queue:');
    for (const { task, review } of humanQueue.getAll()) {
      console.log(`    • ${task.title} (score: ${review.score}/10)`);
      console.log(`      → ${review.feedback}`);
    }
    console.log('\n  In production, these would be sent to Slack/Jira/etc.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
