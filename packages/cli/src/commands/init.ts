/**
 * `clawswarm init` — Initialize a new ClawSwarm project.
 *
 * Creates a project scaffold with config, env template, and goal directory.
 *
 * @module @clawswarm/cli/commands/init
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Project name (defaults to current directory name) */
  name?: string;
  /** Default model for agents */
  model?: string;
  /** Output directory (defaults to cwd) */
  dir?: string;
}

// ─── Init Command ─────────────────────────────────────────────────────────────

/**
 * Initialize a new ClawSwarm project.
 *
 * @param options - Initialization options
 */
export async function initProject(options: InitOptions = {}): Promise<void> {
  const cwd = options.dir ?? process.cwd();
  const projectName = options.name ?? cwd.split('/').pop() ?? 'my-swarm';
  const defaultModel = options.model ?? 'claude-sonnet-4';

  console.log(`\n🐾 Initializing ClawSwarm project: ${projectName}\n`);

  // Create goals directory
  const goalsDir = join(cwd, 'goals');
  if (!existsSync(goalsDir)) {
    mkdirSync(goalsDir, { recursive: true });
    console.log('  ✓ Created goals/');
  }

  // Create clawswarm.config.ts
  const configPath = join(cwd, 'clawswarm.config.ts');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, generateConfig(projectName, defaultModel));
    console.log('  ✓ Created clawswarm.config.ts');
  } else {
    console.log('  ⚠ clawswarm.config.ts already exists — skipping');
  }

  // Create .env.example
  const envExamplePath = join(cwd, '.env.example');
  if (!existsSync(envExamplePath)) {
    writeFileSync(envExamplePath, generateEnvExample());
    console.log('  ✓ Created .env.example');
  }

  // Create example goal
  const exampleGoalPath = join(goalsDir, 'example.ts');
  if (!existsSync(exampleGoalPath)) {
    writeFileSync(exampleGoalPath, generateExampleGoal());
    console.log('  ✓ Created goals/example.ts');
  }

  console.log(`
✅ Project initialized!

Next steps:
  1. Copy .env.example → .env and add your API keys
  2. Edit clawswarm.config.ts to configure your agents
  3. Run \`clawswarm start\` to start the bridge server
  4. Run your first goal: \`npx tsx goals/example.ts\`

Docs: https://github.com/trietphan/clawswarm/tree/main/docs
`);
}

// ─── Template Generators ──────────────────────────────────────────────────────

function generateConfig(projectName: string, defaultModel: string): string {
  return `import { SwarmConfig, Agent } from '@clawswarm/core';

/**
 * ClawSwarm configuration for ${projectName}.
 * Edit this file to configure your agents, models, and review thresholds.
 */
const config: SwarmConfig = {
  agents: [
    Agent.research({ model: '${defaultModel}' }),
    Agent.code({ model: '${defaultModel}' }),
    Agent.ops({ model: '${defaultModel}' }),
  ],

  chiefReview: {
    autoApproveThreshold: 8,   // Score ≥ 8 → auto-approved
    humanReviewThreshold: 5,   // Score 5-7 → human review
    reviewerModel: '${defaultModel}',
  },

  // Optional: connect to a bridge server for real-time updates
  // bridgeUrl: process.env.CLAWSWARM_BRIDGE_URL,

  // Optional: organization ID for multi-tenant setups
  // orgId: process.env.CLAWSWARM_ORG_ID,
};

export default config;
`;
}

function generateEnvExample(): string {
  return `# ClawSwarm Environment Variables
# Copy this file to .env and fill in your values

# LLM API Keys (add the ones you use)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=...

# Bridge Server (optional — for real-time dashboard)
CLAWSWARM_BRIDGE_URL=ws://localhost:8787
CLAWSWARM_BRIDGE_TOKEN=your-secret-token

# Organization ID (optional — for multi-tenant setups)
CLAWSWARM_ORG_ID=my-org
`;
}

function generateExampleGoal(): string {
  return `import { ClawSwarm } from '@clawswarm/core';
import config from '../clawswarm.config.js';

async function main() {
  const swarm = new ClawSwarm(config);

  swarm.on('task:completed', (task) => {
    console.log(\`✅ Task completed: \${task.title}\`);
  });

  const goal = swarm.createGoal({
    title: 'Research AI agent frameworks',
    description: 'Find the top 5 open-source AI agent frameworks in 2026 and summarize their strengths.',
  });

  console.log('🚀 Executing goal:', goal.title);
  const result = await swarm.execute(goal);

  console.log('\\n📦 Deliverables:');
  for (const d of result.deliverables) {
    console.log(\`  - \${d.label}: \${d.content.slice(0, 100)}...\`);
  }

  console.log(\`\\n⏱  Duration: \${result.durationMs}ms\`);
}

main().catch(console.error);
`;
}
