/**
 * `clawswarm run` — Execute a goal using the ClawSwarm framework.
 *
 * @module clawswarm/cli/commands/run
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ClawSwarm } from '../../core/clawswarm.js';
import { Agent } from '../../core/agent.js';
import type { SwarmConfig, Goal, Task, AgentType } from '../../core/types.js';
import type { ReviewResult } from '../../core/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Path to config file (default: clawswarm.config.ts in CWD) */
  config?: string;
  /** Run in verbose mode */
  verbose?: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SwarmConfig = {
  agents: [
    Agent.research({ model: 'claude-sonnet-4' }),
    Agent.code({ model: 'gpt-4o' }),
    Agent.ops({ model: 'gemini-pro' }),
  ],
  chiefReview: {
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
  },
};

// ─── Run Command ──────────────────────────────────────────────────────────────

/**
 * Execute a goal description using the ClawSwarm framework.
 *
 * @param goalDescription - Natural language description of what to accomplish
 * @param options - Run options
 */
export async function runGoal(goalDescription: string, options: RunOptions = {}): Promise<void> {
  if (!goalDescription || goalDescription.trim().length === 0) {
    console.error('❌ Error: Goal description cannot be empty.');
    console.error('   Usage: clawswarm run "<goal description>"');
    process.exit(1);
  }

  console.log('\n🐾 ClawSwarm — Running Goal\n');
  console.log(`  📌 Goal: ${goalDescription}\n`);

  // Load config
  const config = await loadConfig(options.config);

  // Create swarm
  const swarm = new ClawSwarm(config);

  // Wire up progress events
  setupEventListeners(swarm, options.verbose ?? false);

  // Create and execute goal
  const goal = swarm.createGoal({
    title: goalDescription,
    description: goalDescription,
  });

  console.log(`  🆔 Goal ID: ${goal.id}`);
  console.log(`  🤖 Agents: ${config.agents.map(a => a.name ?? a.type).join(', ')}\n`);

  const startTime = Date.now();

  try {
    const result = await swarm.execute(goal);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n─────────────────────────────────────────────────');
    console.log('✅ Goal Completed!\n');
    console.log(`  ⏱  Duration: ${elapsed}s`);
    console.log(`  📦 Deliverables: ${result.deliverables.length}`);

    if (result.cost) {
      console.log(`  💰 Tokens used: ${result.cost.totalTokens}`);
      if (result.cost.estimatedCostUsd > 0) {
        console.log(`  💵 Estimated cost: $${result.cost.estimatedCostUsd.toFixed(4)}`);
      }
    }

    if (result.hadHumanReview) {
      console.log('\n  ℹ  Note: Some tasks required human review.');
    }

    // Print deliverables
    if (result.deliverables.length > 0) {
      console.log('\n─────────────────────────────────────────────────');
      console.log('📋 Deliverables:\n');

      for (const [i, deliverable] of result.deliverables.entries()) {
        console.log(`  [${i + 1}] ${deliverable.label} (${deliverable.type})`);
        console.log('  ' + '─'.repeat(50));

        // Print content (truncate if very long)
        const content = deliverable.content;
        const maxLength = 2000;
        if (content.length > maxLength) {
          console.log('  ' + content.slice(0, maxLength).split('\n').join('\n  '));
          console.log(`  ... [${content.length - maxLength} more characters]`);
        } else {
          console.log('  ' + content.split('\n').join('\n  '));
        }
        console.log();
      }
    } else {
      console.log('\n  ⚠  No deliverables were produced.');
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('\n❌ Goal failed:', err.message);
    if (options.verbose && err.stack) {
      console.error('\n' + err.stack);
    }
    process.exit(1);
  }
}

// ─── Config Loader ────────────────────────────────────────────────────────────

async function loadConfig(configPath?: string): Promise<SwarmConfig> {
  const candidates = configPath
    ? [path.resolve(process.cwd(), configPath)]
    : [
        path.join(process.cwd(), 'clawswarm.config.ts'),
        path.join(process.cwd(), 'clawswarm.config.js'),
        path.join(process.cwd(), 'clawswarm.config.mjs'),
      ];

  for (const candidate of candidates) {
    try {
      const fileUrl = pathToFileURL(candidate).href;
      const mod = await import(fileUrl);
      const config = mod.default ?? mod.config;
      if (config && typeof config === 'object' && Array.isArray(config.agents)) {
        console.log(`  ⚙  Loaded config from: ${candidate}`);
        return config as SwarmConfig;
      }
    } catch {
      // File doesn't exist or failed to load — try next candidate
    }
  }

  // Use defaults
  console.log('  ⚙  Using default config (no clawswarm.config.ts found)');
  return DEFAULT_CONFIG;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners(swarm: ClawSwarm, verbose: boolean): void {
  swarm.on('goal:planning', (_goal: Goal) => {
    console.log('  🗺  Planning tasks...');
  });

  swarm.on('task:assigned', (task: Task, agentType: AgentType) => {
    console.log(`  📋 Task assigned: "${task.title}" → ${agentType}`);
  });

  swarm.on('task:started', (task: Task) => {
    if (verbose) {
      console.log(`  ▶  Task started: "${task.title}"`);
    }
  });

  swarm.on('task:completed', (task: Task) => {
    const delivCount = task.deliverables.length;
    console.log(`  ✅ Task done: "${task.title}" (${delivCount} deliverable${delivCount !== 1 ? 's' : ''})`);
  });

  swarm.on('task:review', (task: Task, review: ReviewResult) => {
    if (verbose) {
      console.log(`  🔍 Review: "${task.title}" — score ${review.score}/10 (${review.decision})`);
    }
  });

  swarm.on('task:rejected', (task: Task, review: ReviewResult) => {
    console.log(`  ⚠  Task rejected: "${task.title}" — ${review.feedback}`);
  });

  swarm.on('task:rework', (task: Task) => {
    console.log(`  🔄 Rework cycle ${task.reworkCount}: "${task.title}"`);
  });

  swarm.on('task:failed', (task: Task, error: Error) => {
    console.error(`  ❌ Task failed: "${task.title}" — ${error.message}`);
  });

  swarm.on('human:review_required', (task: Task, review: ReviewResult) => {
    console.log(`  👁  Human review needed: "${task.title}" (score: ${review.score}/10)`);
    if (review.feedback) {
      console.log(`     Feedback: ${review.feedback}`);
    }
  });
}
