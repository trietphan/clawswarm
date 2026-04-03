/**
 * `clawswarm init` — Interactive wizard to initialize a new ClawSwarm project.
 *
 * @module clawswarm/cli/commands/init
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Project name (defaults to current directory name) */
  name?: string;
  /** Output directory (defaults to cwd) */
  dir?: string;
  /** Skip interactive prompts (use defaults) */
  yes?: boolean;
}

interface WizardAnswers {
  projectName: string;
  providers: string[];
  models: Record<string, string>;
  enableBridge: boolean;
  apiKeys: Record<string, string>;
}

// ─── Default Models ───────────────────────────────────────────────────────────

const PROVIDER_DEFAULT_MODELS: Record<string, string[]> = {
  Anthropic: ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'],
  OpenAI: ['gpt-4o', 'gpt-4o-mini', 'o3'],
  Google: ['gemini-pro', 'gemini-flash', 'gemini-ultra'],
};

const PROVIDER_ENV_KEYS: Record<string, string> = {
  Anthropic: 'ANTHROPIC_API_KEY',
  OpenAI: 'OPENAI_API_KEY',
  Google: 'GOOGLE_AI_API_KEY',
};

// ─── Init Command ─────────────────────────────────────────────────────────────

/**
 * Run the interactive init wizard.
 *
 * @param options - Init options
 */
export async function initProject(options: InitOptions = {}): Promise<void> {
  const cwd = options.dir ?? process.cwd();
  const defaultName = options.name ?? basename(cwd);

  console.log('\n🐾 ClawSwarm Init Wizard\n');

  let answers: WizardAnswers;

  if (options.yes) {
    answers = {
      projectName: defaultName,
      providers: ['Anthropic'],
      models: { Anthropic: 'claude-sonnet-4' },
      enableBridge: false,
      apiKeys: {},
    };
    console.log('  Using defaults (--yes flag)');
  } else {
    answers = await runWizard(defaultName);
  }

  console.log('\n  Generating project files...\n');

  // Create goals directory
  const goalsDir = join(cwd, 'goals');
  if (!existsSync(goalsDir)) {
    mkdirSync(goalsDir, { recursive: true });
    console.log('  ✓ Created goals/');
  }

  // Create clawswarm.config.ts
  const configPath = join(cwd, 'clawswarm.config.ts');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, generateConfig(answers));
    console.log('  ✓ Created clawswarm.config.ts');
  } else {
    console.log('  ⚠  clawswarm.config.ts already exists — skipping');
  }

  // Create .env (with actual keys if provided)
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, generateEnv(answers));
    console.log('  ✓ Created .env');
  } else {
    console.log('  ⚠  .env already exists — skipping');
  }

  // Always create/update .env.example
  const envExamplePath = join(cwd, '.env.example');
  writeFileSync(envExamplePath, generateEnvExample(answers.providers));
  console.log('  ✓ Created .env.example');

  // Create example goal
  const exampleGoalPath = join(goalsDir, 'example.ts');
  if (!existsSync(exampleGoalPath)) {
    writeFileSync(exampleGoalPath, generateExampleGoal(answers));
    console.log('  ✓ Created goals/example.ts');
  }

  // Ensure package.json exists, then install clawswarm
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.log('\n  📦 No package.json found — running npm init...');
    try {
      execSync('npm init -y', { cwd, stdio: 'inherit' });
    } catch {
      console.warn('  ⚠  npm init failed — continuing anyway');
    }
  }

  console.log('\n  📦 Installing clawswarm-ai...');
  try {
    execSync('npm install clawswarm-ai', { cwd, stdio: 'inherit' });
    console.log('  ✓ clawswarm-ai installed');
  } catch {
    console.warn('  ⚠  npm install failed — you can run it manually: npm install clawswarm-ai-ai');
  }

  console.log(`
✅ Project initialized!

Next steps:
  1. Verify your API keys in .env
  2. Edit clawswarm.config.ts if needed
  3. Run your first goal: clawswarm run "Research the top AI frameworks in 2026"
  4. Or run the bridge server: clawswarm start

Docs: https://github.com/trietphan/clawswarm#readme
`);
}

// ─── Interactive Wizard ───────────────────────────────────────────────────────

async function runWizard(defaultName: string): Promise<WizardAnswers> {
  // Dynamically import enquirer to avoid issues if not installed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enquirer: { prompt: (questions: any) => Promise<Record<string, unknown>> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('enquirer');
    enquirer = mod.default ?? mod;
  } catch {
    console.warn('  ⚠  enquirer not found — using defaults');
    return {
      projectName: defaultName,
      providers: ['Anthropic'],
      models: { Anthropic: 'claude-sonnet-4' },
      enableBridge: false,
      apiKeys: {},
    };
  }

  // Step 1: Project name
  const nameAnswer = await enquirer.prompt({
    type: 'input',
    name: 'projectName',
    message: 'Project name:',
    initial: defaultName,
  }) as { projectName: string };

  // Step 2: Providers
  const providerAnswer = await enquirer.prompt({
    type: 'multiselect',
    name: 'providers',
    message: 'Which LLM provider(s) will you use? (Space to select, Enter to confirm)',
    choices: ['Anthropic', 'OpenAI', 'Google'],
    initial: ['Anthropic'],
  }) as { providers: string[] };

  const selectedProviders = providerAnswer.providers.length > 0
    ? providerAnswer.providers
    : ['Anthropic'];

  // Step 3: Default model per provider
  const models: Record<string, string> = {};
  for (const provider of selectedProviders) {
    const choices = PROVIDER_DEFAULT_MODELS[provider] ?? ['default'];
    const modelAnswer = await enquirer.prompt({
      type: 'select',
      name: 'model',
      message: `Default model for ${provider}:`,
      choices,
    }) as { model: string };
    models[provider] = modelAnswer.model;
  }

  // Step 4: Bridge server
  const bridgeAnswer = await enquirer.prompt({
    type: 'confirm',
    name: 'enableBridge',
    message: 'Enable the bridge server for real-time agent updates?',
    initial: false,
  }) as { enableBridge: boolean };

  // Step 5: API keys
  const apiKeys: Record<string, string> = {};
  for (const provider of selectedProviders) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    if (!envKey) continue;

    const keyAnswer = await enquirer.prompt({
      type: 'password',
      name: 'apiKey',
      message: `${provider} API key (${envKey}) — leave blank to skip:`,
    }) as { apiKey: string };

    const key = keyAnswer.apiKey.trim();
    if (key) {
      apiKeys[provider] = key;
      const valid = await validateApiKey(provider, key);
      if (valid) {
        console.log(`  ✅ ${provider} API key validated`);
      } else {
        console.log(`  ⚠  Could not validate ${provider} key — saving anyway`);
      }
    }
  }

  return {
    projectName: nameAnswer.projectName || defaultName,
    providers: selectedProviders,
    models,
    enableBridge: bridgeAnswer.enableBridge,
    apiKeys,
  };
}

// ─── API Key Validation ────────────────────────────────────────────────────────

async function validateApiKey(provider: string, key: string): Promise<boolean> {
  try {
    if (provider === 'OpenAI') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      return res.status === 200;
    }

    if (provider === 'Anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
      });
      return res.status === 200;
    }

    if (provider === 'Google') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
      );
      return res.status === 200;
    }
  } catch {
    // Network error — can't validate
  }
  return false;
}

// ─── Template Generators ──────────────────────────────────────────────────────

function generateConfig(answers: WizardAnswers): string {
  const agentLines: string[] = [];

  for (const provider of answers.providers) {
    const model = answers.models[provider] ?? 'claude-sonnet-4';
    if (provider === 'Anthropic') {
      agentLines.push(`    Agent.research({ model: '${model}' }),`);
    } else if (provider === 'OpenAI') {
      agentLines.push(`    Agent.code({ model: '${model}' }),`);
    } else if (provider === 'Google') {
      agentLines.push(`    Agent.ops({ model: '${model}' }),`);
    }
  }

  // Ensure at least one agent
  if (agentLines.length === 0) {
    agentLines.push(`    Agent.research({ model: 'claude-sonnet-4' }),`);
    agentLines.push(`    Agent.code({ model: 'gpt-4o' }),`);
  }

  const firstModel = Object.values(answers.models)[0] ?? 'claude-sonnet-4';

  const bridgeSection = answers.enableBridge
    ? `\n  // Bridge server for real-time updates
  bridgeUrl: process.env['CLAWSWARM_BRIDGE_URL'],\n`
    : '';

  return `import { SwarmConfig, Agent } from 'clawswarm-ai';

/**
 * ClawSwarm configuration for ${answers.projectName}.
 */
const config: SwarmConfig = {
  agents: [
${agentLines.join('\n')}
  ],

  chiefReview: {
    autoApproveThreshold: 8,
    humanReviewThreshold: 5,
    reviewerModel: '${firstModel}',
  },
${bridgeSection}};

export default config;
`;
}

function generateEnv(answers: WizardAnswers): string {
  const lines: string[] = ['# ClawSwarm Environment Variables', ''];

  for (const provider of answers.providers) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    if (!envKey) continue;
    const value = answers.apiKeys[provider] ?? '';
    lines.push(`${envKey}=${value}`);
  }

  if (answers.enableBridge) {
    lines.push('');
    lines.push('# Bridge Server');
    lines.push('CLAWSWARM_BRIDGE_URL=ws://localhost:8787');
    lines.push('CLAWSWARM_BRIDGE_TOKEN=change-me-secret');
  }

  lines.push('');
  return lines.join('\n');
}

function generateEnvExample(providers: string[]): string {
  const lines: string[] = [
    '# ClawSwarm Environment Variables',
    '# Copy this file to .env and fill in your values',
    '',
  ];

  for (const provider of providers) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    if (!envKey) continue;
    const placeholder = provider === 'Anthropic' ? 'sk-ant-...' : provider === 'OpenAI' ? 'sk-...' : 'your-key';
    lines.push(`${envKey}=${placeholder}`);
  }

  lines.push('');
  lines.push('# Bridge Server (optional)');
  lines.push('CLAWSWARM_BRIDGE_URL=ws://localhost:8787');
  lines.push('CLAWSWARM_BRIDGE_TOKEN=your-secret-token');
  lines.push('');

  return lines.join('\n');
}

function generateExampleGoal(answers: WizardAnswers): string {
  return `import { ClawSwarm } from 'clawswarm-ai';
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
  console.log(\`💬 Project: ${answers.projectName}\`);
}

main().catch(console.error);
`;
}
