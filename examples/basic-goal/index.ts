/**
 * Basic Goal Example — ClawSwarm
 *
 * Demonstrates the simplest way to create and execute a goal.
 * The swarm decomposes the goal into tasks, runs them through
 * specialist agents, and returns deliverables.
 *
 * Run:
 *   npx tsx examples/basic-goal/index.ts
 */

import { ClawSwarm, Agent } from '@clawswarm/core';

async function main() {
  // 1. Create the swarm with specialist agents
  const swarm = new ClawSwarm({
    agents: [
      Agent.research({ model: 'claude-sonnet-4' }),
      Agent.code({ model: 'gpt-4o' }),
      Agent.ops({ model: 'gemini-pro' }),
    ],
    chiefReview: {
      autoApproveThreshold: 8,  // ≥8 → auto-approved
      humanReviewThreshold: 5,  // 5-7 → human review
    },
  });

  // 2. Listen to events for observability
  swarm.on('goal:planning', (goal) => {
    console.log(`\n📋 Planning: ${goal.title}`);
  });

  swarm.on('task:assigned', (task, agentType) => {
    console.log(`  → Assigned "${task.title}" to ${agentType}`);
  });

  swarm.on('task:started', (task) => {
    console.log(`  ⚡ Starting: ${task.title}`);
  });

  swarm.on('task:completed', (task) => {
    console.log(`  ✅ Completed: ${task.title} (${task.deliverables.length} deliverable(s))`);
  });

  swarm.on('task:review', (task, review) => {
    const icon = review.decision === 'approved' ? '✅' : review.decision === 'human_review' ? '👀' : '❌';
    console.log(`  ${icon} Review: ${task.title} — score ${review.score}/10 (${review.decision})`);
  });

  swarm.on('task:rework', (task, review) => {
    console.log(`  🔄 Rework cycle ${task.reworkCount}: ${review.feedback}`);
  });

  swarm.on('human:review_required', (task, review) => {
    console.log(`\n  👀 HUMAN REVIEW REQUIRED`);
    console.log(`     Task: ${task.title}`);
    console.log(`     Score: ${review.score}/10`);
    console.log(`     Feedback: ${review.feedback}`);
  });

  swarm.on('goal:completed', (goal) => {
    console.log(`\n🎉 Goal completed: ${goal.title}`);
  });

  swarm.on('goal:failed', (goal, error) => {
    console.error(`\n💥 Goal failed: ${goal.title}`, error.message);
  });

  // 3. Define the goal
  const goal = swarm.createGoal({
    title: 'Research the top AI agent frameworks',
    description: `
      Find and summarize the top 5 open-source AI agent frameworks in 2026.
      For each framework, include:
      - Name and GitHub URL
      - Key features and use cases
      - Pros and cons
      - Typical user base
      
      Produce a well-structured markdown report.
    `,
    priority: 1,
    tags: ['research', 'ai', 'agents'],
  });

  console.log(`\n🚀 Executing goal: "${goal.title}"`);
  console.log(`   ID: ${goal.id}`);

  // 4. Execute — the swarm handles everything
  const result = await swarm.execute(goal);

  // 5. Display results
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📦 Results`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Duration:      ${result.durationMs}ms`);
  console.log(`  Deliverables:  ${result.deliverables.length}`);
  console.log(`  Total tokens:  ${result.cost.totalTokens}`);
  console.log(`  Est. cost:     $${result.cost.estimatedCostUsd.toFixed(4)} USD`);
  console.log(`  Human review:  ${result.hadHumanReview ? 'yes' : 'no'}`);
  console.log();

  for (const [i, d] of result.deliverables.entries()) {
    console.log(`  [${i + 1}] ${d.label} (${d.type})`);
    console.log(`      ${d.content.slice(0, 150).replace(/\n/g, ' ')}...`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
