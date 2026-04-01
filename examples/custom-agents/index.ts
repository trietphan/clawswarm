/**
 * Custom Agents Example — ClawSwarm
 *
 * Demonstrates how to create custom specialist agents with
 * custom tools, system prompts, and execution logic.
 *
 * Run:
 *   npx tsx examples/custom-agents/index.ts
 */

// Load API keys from environment — see .env.example at the repo root.
import 'dotenv/config';

import { ClawSwarm, Agent, Task, Deliverable } from '@clawswarm/core';

// ─── Custom Agent: DataAnalyst ────────────────────────────────────────────────

/**
 * A custom data analyst agent.
 *
 * Extends Agent with specialized logic for analyzing datasets,
 * generating summaries, and producing visualizations.
 */
class DataAnalystAgent extends Agent {
  constructor() {
    super({
      type: 'custom',
      name: 'DataAnalystClaw',
      model: 'claude-sonnet-4',
      tools: ['read_file', 'execute_python', 'generate_chart'],
      systemPrompt: `You are DataAnalystClaw, a specialist data analysis agent.
Your job is to analyze datasets, identify patterns, generate statistical summaries,
and produce clear visualizations. Always cite your methodology. Use Python for analysis.`,
      temperature: 0.2, // low temperature for analytical accuracy
    });
  }

  /**
   * Override canHandle to only accept analysis tasks.
   */
  override canHandle(task: Task): boolean {
    return /analyz|data|statistic|chart|visualiz/i.test(task.title + task.description);
  }

  /**
   * Override execute with custom data analysis logic.
   */
  override async execute(task: Task): Promise<Deliverable[]> {
    console.log(`  [DataAnalyst] Analyzing: ${task.title}`);

    // Simulate data analysis pipeline
    await this._loadData(task);
    const analysis = await this._runAnalysis(task);
    const chart = await this._generateChart(analysis);

    return [
      {
        type: 'text',
        label: 'Analysis Summary',
        content: analysis.summary,
      },
      {
        type: 'code',
        label: 'Analysis Script (Python)',
        content: analysis.script,
        mimeType: 'text/x-python',
      },
      {
        type: 'data',
        label: 'Chart Data',
        content: JSON.stringify(chart),
        mimeType: 'application/json',
      },
    ];
  }

  // Stub implementations — replace with real logic

  private async _loadData(_task: Task): Promise<void> {
    await sleep(100);
  }

  private async _runAnalysis(task: Task): Promise<{ summary: string; script: string }> {
    await sleep(200);
    return {
      summary: `Analysis complete for: ${task.title}.\n\nKey findings:\n- Trend A observed\n- Pattern B detected\n- Anomaly C flagged for review`,
      script: `import pandas as pd\nimport matplotlib.pyplot as plt\n\n# Load data\ndf = pd.read_csv('data.csv')\nprint(df.describe())`,
    };
  }

  private async _generateChart(_analysis: { summary: string }): Promise<object> {
    await sleep(100);
    return {
      type: 'bar',
      data: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [42, 65, 38, 89] },
    };
  }
}

// ─── Custom Agent: WriterClaw ─────────────────────────────────────────────────

/**
 * A custom writer agent specialized for long-form content.
 */
class WriterClawAgent extends Agent {
  constructor() {
    super({
      type: 'custom',
      name: 'WriterClaw',
      model: 'claude-opus-4',
      tools: ['web_search', 'web_fetch'],
      systemPrompt: `You are WriterClaw, a specialist content writer.
You write engaging, well-researched long-form content. You always:
- Structure content with clear headings
- Back claims with evidence
- Write in an accessible, engaging style
- Aim for 800-1500 words unless instructed otherwise`,
      temperature: 0.7, // higher temperature for creative writing
      maxTokens: 4000,
    });
  }

  override async execute(task: Task): Promise<Deliverable[]> {
    console.log(`  [WriterClaw] Writing: ${task.title}`);

    await sleep(300); // simulate LLM call

    const content = await this._writeContent(task);

    return [
      {
        type: 'text',
        label: 'Article Draft',
        content,
        mimeType: 'text/markdown',
      },
    ];
  }

  private async _writeContent(task: Task): Promise<string> {
    await sleep(200);
    return `# ${task.title}\n\n## Introduction\n\nThis article explores ${task.description}.\n\n## Main Points\n\n1. First key insight...\n2. Second key insight...\n3. Third key insight...\n\n## Conclusion\n\nIn summary, this topic demonstrates...`;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dataAnalyst = new DataAnalystAgent();
  const writerClaw = new WriterClawAgent();

  console.log('📋 Registered agents:');
  console.log(`  - ${dataAnalyst.name} (${dataAnalyst.type})`);
  console.log(`  - ${writerClaw.name} (${writerClaw.type})`);
  console.log();

  // Register custom agents in the swarm
  // Note: ClawSwarm uses AgentConfig for the agents array, but you can
  // directly inject custom agent instances via the config
  const swarm = new ClawSwarm({
    agents: [
      Agent.research({ model: 'claude-sonnet-4' }),
      // Custom agents are registered via their config
      dataAnalyst.config,
      writerClaw.config,
    ],
    chiefReview: {
      autoApproveThreshold: 7,
    },
  });

  // Listen for events
  swarm.on('task:completed', (task) => {
    console.log(`  ✅ ${task.title} — ${task.deliverables.length} deliverable(s)`);
  });

  const goal = swarm.createGoal({
    title: 'Analyze Q4 2026 market trends and write a report',
    description: `
      1. Analyze the Q4 2026 sales dataset
      2. Identify top trends and anomalies  
      3. Write an executive summary article based on the analysis
    `,
  });

  console.log(`🚀 Executing: ${goal.title}\n`);
  const result = await swarm.execute(goal);

  console.log(`\n✅ Done! ${result.deliverables.length} deliverables produced.`);
  for (const d of result.deliverables) {
    console.log(`  - ${d.label} (${d.type})`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
