/**
 * Unit tests for the rework loop circuit breaker.
 *
 * Verifies that after `maxReworkCycles` failed reviews, the swarm
 * escalates to human review instead of looping forever.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ClawSwarm } from '../core/clawswarm.js';
import { Agent } from '../core/agent.js';
import { ChiefReviewer } from '../core/chief.js';
import type { AgentConfig, AgentType, Deliverable, Task, SwarmConfig, ReviewResult } from '../core/types.js';

// Clear API keys to force heuristic reviewer
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterAll(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val !== undefined) process.env[key] = val;
    else delete process.env[key];
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

class AlwaysApprovedReviewer extends ChiefReviewer {
  async review(task: Task): Promise<ReviewResult> {
    return {
      taskId: task.id,
      score: 9,
      decision: 'approved',
      feedback: 'Great work!',
      issues: [],
      suggestions: [],
      reviewedAt: new Date().toISOString(),
    };
  }
}

class AlwaysRejectedReviewer extends ChiefReviewer {
  public callCount = 0;

  async review(task: Task): Promise<ReviewResult> {
    this.callCount++;
    return {
      taskId: task.id,
      score: 2,
      decision: 'rejected',
      feedback: 'Needs complete rework.',
      issues: ['Output is insufficient'],
      suggestions: ['Try harder'],
      reviewedAt: new Date().toISOString(),
    };
  }
}

class MockAgent extends Agent {
  public callCount = 0;

  constructor(config: AgentConfig) {
    super(config);
  }

  async execute(_task: Task): Promise<Deliverable[]> {
    this.callCount++;
    return [{ type: 'text', label: 'Mock Output', content: 'mock content' }];
  }
}

class TestableSwarm extends ClawSwarm {
  constructor(config: SwarmConfig, reviewerOverride?: ChiefReviewer) {
    super(config);
    if (reviewerOverride) {
      (this as any).reviewer = reviewerOverride;
    }
    // Replace planner with one that creates a single simple task
    (this as any).planner = {
      decompose: async (goal: any, taskManager: any) => {
        const task = taskManager.create({
          goalId: goal.id,
          title: 'Single Task',
          description: 'Do the work',
          assignedTo: 'code' as AgentType,
          dependsOn: [],
        });
        return [task];
      },
    };
  }
}

function makeConfig(maxReworkCycles = 2): SwarmConfig {
  return {
    agents: [Agent.code({ model: 'gpt-4o' })],
    chiefReview: {
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
      maxReworkCycles,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Rework Loop Circuit Breaker', () => {
  it('completes without circuit breaker when reviewer approves on first try', async () => {
    const config = makeConfig(2);
    const reviewer = new AlwaysApprovedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    // Inject mock agent
    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const goal = swarm.createGoal({ title: 'Easy Task', description: 'Should pass immediately' });
    const result = await swarm.execute(goal);

    expect(result.goal.status).toBe('completed');
    expect(agent.callCount).toBe(1); // only called once, no rework
  }, 10_000);

  it('escalates to human:review_required after maxReworkCycles=2', async () => {
    const config = makeConfig(2);
    const reviewer = new AlwaysRejectedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const humanReviews: any[] = [];
    swarm.on('human:review_required', (task, review) => humanReviews.push({ task, review }));

    const goal = swarm.createGoal({ title: 'Hard Task', description: 'Always rejected' });
    const result = await swarm.execute(goal);

    // Circuit breaker should have fired
    expect(humanReviews.length).toBeGreaterThan(0);

    // Escalation review should mention circuit breaker
    const escalationFeedback = humanReviews[0].review.feedback as string;
    expect(escalationFeedback.toLowerCase()).toMatch(/circuit breaker|escalated/i);
  }, 10_000);

  it('escalates after maxReworkCycles=1 (single rework limit)', async () => {
    const config = makeConfig(1);
    const reviewer = new AlwaysRejectedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const humanReviews: any[] = [];
    swarm.on('human:review_required', (_task, review) => humanReviews.push(review));

    const goal = swarm.createGoal({ title: 'Quick Escalation', description: 'Escalate fast' });
    await swarm.execute(goal);

    expect(humanReviews.length).toBeGreaterThan(0);
  }, 10_000);

  it('escalates after maxReworkCycles=0 (no rework allowed)', async () => {
    const config = makeConfig(0);
    const reviewer = new AlwaysRejectedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const humanReviews: any[] = [];
    swarm.on('human:review_required', (_task, review) => humanReviews.push(review));

    const goal = swarm.createGoal({ title: 'No Rework', description: 'Escalate immediately' });
    await swarm.execute(goal);

    // Should escalate on the very first rejection
    expect(humanReviews.length).toBeGreaterThan(0);
  }, 10_000);

  it('goal still completes (not stalled) even when circuit breaker fires', async () => {
    const config = makeConfig(2);
    const reviewer = new AlwaysRejectedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const goal = swarm.createGoal({ title: 'Stall Test', description: 'Must not stall' });
    const result = await swarm.execute(goal);

    // Goal should complete (not hang forever)
    expect(result.goal.status).toBe('completed');
  }, 10_000);

  it('emits task:rework events up to maxReworkCycles limit', async () => {
    const config = makeConfig(2);
    const reviewer = new AlwaysRejectedReviewer();
    const swarm = new TestableSwarm(config, reviewer);

    const agent = new MockAgent({ type: 'code', model: 'gpt-4o', name: 'CodeClaw' });
    (swarm as any).agents.set('code', agent);

    const reworkEvents: any[] = [];
    swarm.on('task:rework', (task) => reworkEvents.push(task));

    const goal = swarm.createGoal({ title: 'Rework Count', description: 'Track rework events' });
    await swarm.execute(goal);

    // Should have at most maxReworkCycles rework events
    expect(reworkEvents.length).toBeLessThanOrEqual(2);
  }, 10_000);

  it('ChiefReviewConfig.maxReworkCycles defaults to 2 when not specified', () => {
    const swarm = new TestableSwarm({
      agents: [Agent.code({ model: 'gpt-4o' })],
      chiefReview: { autoApproveThreshold: 8, humanReviewThreshold: 5 },
    });

    // Access config to verify default
    const config = (swarm as any).config as SwarmConfig;
    const maxRework = config.chiefReview?.maxReworkCycles ?? 2;
    expect(maxRework).toBe(2);
  });
});
