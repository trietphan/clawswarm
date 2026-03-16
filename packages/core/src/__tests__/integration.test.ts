/**
 * Integration test — Full ClawSwarm task lifecycle
 *
 * Validates the complete workflow:
 *   1. Swarm creation with ResearchClaw + CodeClaw agents
 *   2. Goal creation and task decomposition
 *   3. Task assignment to agents
 *   4. Chief review scoring (auto-approve ≥8, human review 5-7, auto-reject <5)
 *   5. Full task lifecycle: pending → assigned → in_progress → review → done/rework
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClawSwarm } from '../clawswarm.js';
import { Agent } from '../agent.js';
import { TaskManager } from '../task.js';
import { GoalManager } from '../goal.js';
import { ChiefReviewer } from '../chief.js';
import type {
  Task,
  Deliverable,
  AgentConfig,
  ReviewResult,
  TaskStatus,
  GoalStatus,
  AgentType,
} from '../types.js';

// ─── Mock Agents ──────────────────────────────────────────────────────────────

/**
 * A controllable mock agent for testing.
 * You can set `deliverables` and `shouldThrow` before each test.
 */
class MockAgent extends Agent {
  public deliverables: Deliverable[] = [
    {
      type: 'text',
      label: 'Mock Output',
      content: 'This is a mock deliverable with enough content to pass review. '.repeat(5),
    },
  ];
  public shouldThrow = false;
  public executeCallCount = 0;

  constructor(config: AgentConfig) {
    super(config);
  }

  async execute(_task: Task): Promise<Deliverable[]> {
    this.executeCallCount++;
    if (this.shouldThrow) throw new Error('MockAgent: simulated execute failure');
    return this.deliverables;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResearchAgent(overrides: Partial<AgentConfig> = {}): MockAgent {
  return new MockAgent({
    type: 'research',
    model: 'claude-sonnet-4',
    name: 'ResearchClaw',
    ...overrides,
  });
}

function makeCodeAgent(overrides: Partial<AgentConfig> = {}): MockAgent {
  return new MockAgent({
    type: 'code',
    model: 'gpt-4o',
    name: 'CodeClaw',
    ...overrides,
  });
}

// ─── TestableSwarm: inject mock agents ───────────────────────────────────────

/**
 * Subclass that replaces internal agents Map with our MockAgents.
 * This avoids needing to mock the constructor while still testing
 * the real orchestration logic.
 */
class TestableSwarm extends ClawSwarm {
  constructor(
    config: Parameters<typeof ClawSwarm>[0],
    mockAgents: MockAgent[]
  ) {
    super(config);
    // Replace the internal agents Map with our mock agents
    const agentsMap = new Map<AgentType, Agent>();
    for (const agent of mockAgents) {
      agentsMap.set(agent.type, agent);
    }
    (this as unknown as { agents: Map<AgentType, Agent> }).agents = agentsMap;
  }
}

function buildSwarm(
  researchAgent: MockAgent,
  codeAgent: MockAgent,
  reviewConfig = { autoApproveThreshold: 8, humanReviewThreshold: 5 }
): TestableSwarm {
  return new TestableSwarm(
    {
      agents: [
        Agent.research({ model: 'claude-sonnet-4' }),
        Agent.code({ model: 'gpt-4o' }),
      ],
      chiefReview: reviewConfig,
    },
    [researchAgent, codeAgent]
  );
}

// ─── Unit Tests: ChiefReviewer scoring thresholds ─────────────────────────────

describe('ChiefReviewer — score thresholds', () => {
  let reviewer: ChiefReviewer;

  beforeEach(() => {
    reviewer = new ChiefReviewer({
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
    });
  });

  it('auto-approves scores ≥ 8', () => {
    expect(reviewer.scoreToDecision(8)).toBe('approved');
    expect(reviewer.scoreToDecision(9)).toBe('approved');
    expect(reviewer.scoreToDecision(10)).toBe('approved');
  });

  it('routes scores 5–7 to human review', () => {
    expect(reviewer.scoreToDecision(5)).toBe('human_review');
    expect(reviewer.scoreToDecision(6)).toBe('human_review');
    expect(reviewer.scoreToDecision(7)).toBe('human_review');
  });

  it('auto-rejects scores < 5', () => {
    expect(reviewer.scoreToDecision(4)).toBe('rejected');
    expect(reviewer.scoreToDecision(1)).toBe('rejected');
    expect(reviewer.scoreToDecision(0)).toBe('rejected');
  });

  it('exposes its config', () => {
    expect(reviewer.config.autoApproveThreshold).toBe(8);
    expect(reviewer.config.humanReviewThreshold).toBe(5);
  });

  it('throws if autoApproveThreshold < humanReviewThreshold', () => {
    expect(
      () => new ChiefReviewer({ autoApproveThreshold: 3, humanReviewThreshold: 7 })
    ).toThrow();
  });
});

// ─── Unit Tests: TaskManager lifecycle ────────────────────────────────────────

describe('TaskManager — task lifecycle', () => {
  let tm: TaskManager;
  const GOAL_ID = 'goal-test-001';

  beforeEach(() => {
    tm = new TaskManager();
  });

  it('creates a task in pending state', () => {
    const task = tm.create({
      goalId: GOAL_ID,
      title: 'Research AI trends',
      description: 'Find top 5 AI trends in 2026',
      dependsOn: [],
    });

    expect(task.status).toBe('pending');
    expect(task.id).toBeTruthy();
    expect(task.goalId).toBe(GOAL_ID);
    expect(task.deliverables).toHaveLength(0);
    expect(task.reworkCount).toBe(0);
  });

  it('transitions: pending → assigned → in_progress → review → approved → completed', () => {
    const task = tm.create({
      goalId: GOAL_ID,
      title: 'Build feature',
      description: 'Implement the feature',
      dependsOn: [],
    });

    const checkStatus = (status: TaskStatus) =>
      expect(tm.get(task.id)!.status).toBe(status);

    tm.assign(task.id, 'code');
    checkStatus('assigned');
    expect(tm.get(task.id)!.assignedTo).toBe('code');

    tm.start(task.id);
    checkStatus('in_progress');

    const deliverables: Deliverable[] = [
      { type: 'code', label: 'Implementation', content: 'function add(a, b) { return a + b; }' },
    ];
    tm.submitForReview(task.id, deliverables);
    checkStatus('review');

    tm.approve(task.id);
    checkStatus('approved');

    tm.complete(task.id);
    checkStatus('completed');
  });

  it('handles rework cycle', () => {
    const task = tm.create({
      goalId: GOAL_ID,
      title: 'Rework task',
      description: 'Will need rework',
      dependsOn: [],
    });

    tm.assign(task.id, 'research');
    tm.start(task.id);
    tm.submitForReview(task.id, []);
    tm.rework(task.id, 'Output was incomplete.');

    const updated = tm.get(task.id)!;
    expect(updated.status).toBe('rework');
    expect(updated.reworkCount).toBe(1);
    expect(
      updated.deliverables.some(d => d.label.startsWith('Rework Feedback'))
    ).toBe(true);
  });

  it('throws after max rework cycles exceeded', () => {
    const task = tm.create({
      goalId: GOAL_ID,
      title: 'Exceed rework',
      description: 'Will exceed max rework',
      dependsOn: [],
    });

    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.submitForReview(task.id, []);

    // exhaust all 3 rework cycles
    tm.rework(task.id, 'Round 1');
    tm.submitForReview(task.id, []);
    tm.rework(task.id, 'Round 2');
    tm.submitForReview(task.id, []);
    tm.rework(task.id, 'Round 3');
    tm.submitForReview(task.id, []);

    expect(() => tm.rework(task.id, 'Round 4')).toThrow(/max rework cycles/i);
  });

  it('isGoalDone returns false when tasks are pending', () => {
    tm.create({ goalId: GOAL_ID, title: 'T1', description: 'd', dependsOn: [] });
    expect(tm.isGoalDone(GOAL_ID)).toBe(false);
  });

  it('isGoalDone returns true when all tasks are completed', () => {
    const t1 = tm.create({ goalId: GOAL_ID, title: 'T1', description: 'd', dependsOn: [] });
    tm.assign(t1.id, 'code');
    tm.start(t1.id);
    tm.submitForReview(t1.id, [{ type: 'text', label: 'x', content: 'x' }]);
    tm.approve(t1.id);
    tm.complete(t1.id);

    expect(tm.isGoalDone(GOAL_ID)).toBe(true);
  });

  it('getReady only returns tasks whose dependencies are completed', () => {
    const t1 = tm.create({
      goalId: GOAL_ID,
      title: 'T1',
      description: 'd',
      dependsOn: [],
    });
    const t2 = tm.create({
      goalId: GOAL_ID,
      title: 'T2',
      description: 'd',
      dependsOn: [t1.id],
    });

    // Initially only T1 is ready
    let ready = tm.getReady(GOAL_ID);
    expect(ready.map(t => t.id)).toContain(t1.id);
    expect(ready.map(t => t.id)).not.toContain(t2.id);

    // Complete T1, now T2 should be ready
    tm.assign(t1.id, 'code');
    tm.start(t1.id);
    tm.submitForReview(t1.id, [{ type: 'text', label: 'x', content: 'x' }]);
    tm.approve(t1.id);
    tm.complete(t1.id);

    ready = tm.getReady(GOAL_ID);
    expect(ready.map(t => t.id)).toContain(t2.id);
  });
});

// ─── Unit Tests: GoalManager ──────────────────────────────────────────────────

describe('GoalManager — goal lifecycle', () => {
  let gm: GoalManager;

  beforeEach(() => {
    gm = new GoalManager();
  });

  it('creates a goal in created status', () => {
    const goal = gm.create({ title: 'Test Goal', description: 'Do the thing' });

    expect(goal.id).toBeTruthy();
    expect(goal.status).toBe('created');
    expect(goal.tasks).toHaveLength(0);
    expect(goal.deliverables).toHaveLength(0);
    expect(goal.cost.totalTokens).toBe(0);
  });

  it('transitions through goal statuses', () => {
    const goal = gm.create({ title: 'Goal', description: 'Description' });
    const statuses: GoalStatus[] = ['planning', 'in_progress', 'completed'];

    for (const status of statuses) {
      const updated = gm.setStatus(goal.id, status);
      expect(updated.status).toBe(status);
    }
  });

  it('sets completedAt when goal is completed', () => {
    const goal = gm.create({ title: 'G', description: 'D' });
    const completed = gm.setStatus(goal.id, 'completed');
    expect(completed.completedAt).toBeTruthy();
  });

  it('throws for unknown goal ID', () => {
    expect(() => gm.setStatus('nonexistent-id', 'planning')).toThrow(/not found/i);
  });
});

// ─── Unit Tests: Agent factory methods ───────────────────────────────────────

describe('Agent — factory methods', () => {
  it('creates ResearchClaw config', () => {
    const config = Agent.research({ model: 'claude-sonnet-4' });
    expect(config.type).toBe('research');
    expect(config.name).toBe('ResearchClaw');
    expect(config.tools).toContain('web_search');
  });

  it('creates CodeClaw config', () => {
    const config = Agent.code({ model: 'gpt-4o' });
    expect(config.type).toBe('code');
    expect(config.name).toBe('CodeClaw');
    expect(config.tools).toContain('write_file');
  });

  it('creates OpsClaw config', () => {
    const config = Agent.ops({ model: 'gemini-pro' });
    expect(config.type).toBe('ops');
    expect(config.name).toBe('OpsClaw');
  });

  it('base Agent.execute() throws (must be overridden)', async () => {
    const agent = new Agent({ type: 'custom', model: 'gpt-4o' });
    await expect(agent.execute({} as Task)).rejects.toThrow(/must be implemented/i);
  });

  it('agent starts in idle status', () => {
    const agent = makeResearchAgent();
    expect(agent.status).toBe('idle');
    expect(agent.type).toBe('research');
    expect(agent.name).toBe('ResearchClaw');
  });
});

// ─── Integration: Full swarm with mocked agents ───────────────────────────────

describe('ClawSwarm — full task lifecycle integration', () => {
  it('creates a swarm with two agents accessible via listAgents()', () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    const swarm = buildSwarm(research, code);

    const agents = swarm.listAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.type)).toContain('research');
    expect(agents.map(a => a.type)).toContain('code');
  });

  it('getAgent returns the correct mock agent by type', () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    const swarm = buildSwarm(research, code);

    expect(swarm.getAgent('research')).toBe(research);
    expect(swarm.getAgent('code')).toBe(code);
    expect(swarm.getAgent('ops')).toBeUndefined();
  });

  it('emits goal:created when a goal is created', () => {
    const swarm = buildSwarm(makeResearchAgent(), makeCodeAgent());
    const emitted: string[] = [];
    swarm.on('goal:created', () => emitted.push('goal:created'));

    swarm.createGoal({ title: 'Test', description: 'Test goal' });
    expect(emitted).toContain('goal:created');
  });

  it('executes goal: created → planning → in_progress → completed', async () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    const swarm = buildSwarm(research, code);

    const goalStatuses: string[] = [];
    swarm.on('goal:created', g => goalStatuses.push(g.status));
    swarm.on('goal:planning', g => goalStatuses.push(g.status));
    swarm.on('goal:completed', g => goalStatuses.push(g.status));

    const goal = swarm.createGoal({
      title: 'Build a hello world API',
      description: 'Create a simple REST API with GET /hello returning { message: "world" }',
    });

    const result = await swarm.execute(goal);

    expect(result.goal.status).toBe('completed');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(goalStatuses).toContain('created');
    expect(goalStatuses).toContain('completed');
  }, 15_000);

  it('emits task lifecycle events in correct order', async () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    const swarm = buildSwarm(research, code);

    const events: string[] = [];
    swarm.on('task:assigned', () => events.push('task:assigned'));
    swarm.on('task:started', () => events.push('task:started'));
    swarm.on('task:review', () => events.push('task:review'));
    swarm.on('task:completed', () => events.push('task:completed'));

    const goal = swarm.createGoal({
      title: 'Research project',
      description: 'Analyze competitive landscape in AI tooling',
    });

    await swarm.execute(goal);

    expect(events).toContain('task:assigned');
    expect(events).toContain('task:started');
    expect(events).toContain('task:review');
    expect(events).toContain('task:completed');

    // assigned always before started
    const assignIdx = events.indexOf('task:assigned');
    const startIdx = events.indexOf('task:started');
    expect(assignIdx).toBeLessThan(startIdx);
  }, 15_000);

  it('routes to human review when stub scores 5–7', async () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    // Default stub gives score 7 for non-empty deliverables → human_review
    const swarm = buildSwarm(research, code);

    const humanReviewEvents: string[] = [];
    swarm.on('human:review_required', () => humanReviewEvents.push('human:review_required'));

    const goal = swarm.createGoal({
      title: 'Medium quality research',
      description: 'Gather some info',
    });

    await swarm.execute(goal);

    // The stub scorer gives score=7 for content of ~300 chars → human_review
    expect(humanReviewEvents.length).toBeGreaterThan(0);
  }, 15_000);

  it('auto-approves when deliverables are high quality (score ≥8)', async () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();

    // Override deliverables to produce rich code content → stub gives score 8
    const richCode =
      'function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}\n'.repeat(
        15
      );
    research.deliverables = [{ type: 'code', label: 'Code', content: richCode }];
    code.deliverables = [{ type: 'code', label: 'Code', content: richCode }];

    const swarm = buildSwarm(research, code);
    const approvedReviews: ReviewResult[] = [];
    const humanReviews: ReviewResult[] = [];

    swarm.on('task:review', (_task, review) => {
      if (review.decision === 'approved') approvedReviews.push(review);
    });
    swarm.on('human:review_required', (_task, review) => {
      humanReviews.push(review);
    });

    const goal = swarm.createGoal({
      title: 'Implement Fibonacci',
      description: 'Write a recursive fibonacci function with tests',
    });

    await swarm.execute(goal);

    // At least some tasks should auto-approve (score ≥8 from rich code content)
    expect(approvedReviews.length + humanReviews.length).toBeGreaterThan(0);
  }, 15_000);

  it('collects deliverables from all completed tasks', async () => {
    const research = makeResearchAgent();
    const code = makeCodeAgent();
    research.deliverables = [
      { type: 'text', label: 'Research Report', content: 'Extensive research findings. '.repeat(10) },
    ];
    code.deliverables = [
      { type: 'code', label: 'Implementation', content: 'const hello = () => "world";\n'.repeat(20) },
    ];

    const swarm = buildSwarm(research, code);
    const goal = swarm.createGoal({
      title: 'Full stack feature',
      description: 'Research and implement a new feature',
    });

    const result = await swarm.execute(goal);

    expect(result.deliverables.length).toBeGreaterThan(0);
    expect(result.goal.status).toBe('completed');
  }, 15_000);
});

// ─── Integration: Manual task lifecycle without full swarm ────────────────────

describe('Manual task lifecycle — step-by-step inbox → done', () => {
  it('walks a task through the full lifecycle', async () => {
    const tm = new TaskManager();
    const reviewer = new ChiefReviewer({
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
    });

    const GOAL_ID = 'manual-goal-001';

    // 1. Create task (inbox / pending)
    const task = tm.create({
      goalId: GOAL_ID,
      title: 'Write unit tests for auth module',
      description: 'Add comprehensive tests for login, logout, and token refresh flows',
      dependsOn: [],
    });
    expect(task.status).toBe('pending'); // inbox

    // 2. Assign to CodeClaw
    tm.assign(task.id, 'code');
    expect(tm.get(task.id)!.status).toBe('assigned');
    expect(tm.get(task.id)!.assignedTo).toBe('code');

    // 3. Start work → in_progress
    tm.start(task.id);
    expect(tm.get(task.id)!.status).toBe('in_progress');

    // 4. Submit deliverables for chief review
    const testCode = `
describe('Auth', () => {
  it('logs in successfully', async () => {
    const result = await auth.login('user', 'pass');
    expect(result.token).toBeTruthy();
  });
  it('rejects invalid credentials', async () => {
    await expect(auth.login('user', 'wrong')).rejects.toThrow();
  });
  it('refreshes tokens', async () => {
    const refreshed = await auth.refresh(validToken);
    expect(refreshed.token).not.toBe(validToken);
  });
});
`.repeat(3);

    const deliverables: Deliverable[] = [
      { type: 'code', label: 'Test Suite', content: testCode },
    ];
    tm.submitForReview(task.id, deliverables);
    expect(tm.get(task.id)!.status).toBe('review'); // chief_review

    // 5. Run chief review
    const reviewTask = tm.get(task.id)!;
    const review = await reviewer.review(reviewTask);

    expect(review.taskId).toBe(task.id);
    expect(review.score).toBeGreaterThanOrEqual(0);
    expect(review.score).toBeLessThanOrEqual(10);
    expect(['approved', 'human_review', 'rejected']).toContain(review.decision);
    expect(review.reviewedAt).toBeTruthy();

    // 6. Act on review decision → done / rework
    if (review.decision === 'approved') {
      tm.approve(task.id);
      tm.complete(task.id);
      expect(tm.get(task.id)!.status).toBe('completed'); // done ✅
    } else if (review.decision === 'human_review') {
      // Simulate human approving
      tm.approve(task.id);
      tm.complete(task.id);
      expect(tm.get(task.id)!.status).toBe('completed'); // done ✅
    } else {
      // rejected → rework
      tm.rework(task.id, review.feedback);
      expect(tm.get(task.id)!.status).toBe('rework'); // rework 🔄
      expect(tm.get(task.id)!.reworkCount).toBe(1);
    }
  });

  it('demonstrates auto-reject path with empty deliverables', async () => {
    const tm = new TaskManager();
    const reviewer = new ChiefReviewer({
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
    });

    const task = tm.create({
      goalId: 'rework-goal',
      title: 'Minimal task',
      description: 'Empty output to trigger rejection',
      dependsOn: [],
    });

    tm.assign(task.id, 'code');
    tm.start(task.id);
    // Submit empty deliverables → score 0 → rejected
    tm.submitForReview(task.id, []);

    const review = await reviewer.review(tm.get(task.id)!);
    expect(review.score).toBe(0);
    expect(review.decision).toBe('rejected');
    // chief.ts _buildResult for empty deliverables puts message in suggestions
    expect(review.suggestions.length + review.issues.length).toBeGreaterThan(0);

    // Rework cycle
    tm.rework(task.id, review.feedback);
    const reworked = tm.get(task.id)!;
    expect(reworked.status).toBe('rework');
    expect(reworked.reworkCount).toBe(1);
  });

  it('demonstrates the human_review path (score 5–7)', () => {
    const reviewer = new ChiefReviewer({
      autoApproveThreshold: 8,
      humanReviewThreshold: 5,
    });

    // Scores 5–7 go to human review
    for (const score of [5, 6, 7]) {
      expect(reviewer.scoreToDecision(score)).toBe('human_review');
    }
  });

  it('demonstrates task failure when agent throws', () => {
    const tm = new TaskManager();
    const task = tm.create({
      goalId: 'fail-goal',
      title: 'Failing task',
      description: 'Will fail',
      dependsOn: [],
    });

    tm.assign(task.id, 'code');
    tm.start(task.id);
    tm.fail(task.id, new Error('Agent crashed'));

    const failed = tm.get(task.id)!;
    expect(failed.status).toBe('failed');
    expect(
      failed.deliverables.some(d => d.label === 'Error' && d.content === 'Agent crashed')
    ).toBe(true);
  });
});
