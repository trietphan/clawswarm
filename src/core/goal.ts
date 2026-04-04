/**
 * Goal decomposition and planning.
 * @module @clawswarm/core/goal
 */

import { Goal, GoalStatus, CreateGoalInput, Task, AgentType, SwarmConfig } from './types.js';
import { TaskManager } from './task.js';
import { createProvider } from './providers/index.js';

// ─── Goal Planner ─────────────────────────────────────────────────────────────

/**
 * Decomposes high-level goals into concrete, assignable tasks.
 *
 * The Planner analyzes a goal description and generates a task plan,
 * assigns each task to the appropriate specialist agent, and sequences
 * tasks based on their dependencies.
 *
 * @example
 * ```typescript
 * const planner = new GoalPlanner(swarmConfig);
 * const tasks = await planner.decompose(goal, taskManager);
 * ```
 */
export class GoalPlanner {
  constructor(private readonly config: SwarmConfig) {}

  /**
   * Decompose a goal into a list of tasks.
   * Creates tasks via the TaskManager and returns them in execution order.
   */
  async decompose(goal: Goal, taskManager: TaskManager): Promise<Task[]> {
    const plan = await this._generatePlan(goal);
    const tasks: Task[] = [];

    // Create tasks from plan (maintaining dependency ordering)
    for (const step of plan) {
      const task = taskManager.create({
        goalId: goal.id,
        title: step.title,
        description: step.description,
        assignedTo: step.agentType,
        dependsOn: step.dependsOnTitles
          ? tasks
            .filter(t => step.dependsOnTitles!.includes(t.title))
            .map(t => t.id)
          : [],
      });
      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Generate a task plan for a goal using an LLM.
   * Falls back to a basic 3-step plan if LLM call fails.
   */
  private async _generatePlan(goal: Goal): Promise<PlanStep[]> {
    // Determine planner model — try each agent model in order until one works
    const candidateModels = [
      this.config.agents[0]?.model ?? 'gemini-pro',
      ...this.config.agents.slice(1).map(a => a.model),
    ];

    // Also add default fallback models based on available API keys
    if (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY) {
      candidateModels.push('gemini-pro');
    }
    if (process.env.ANTHROPIC_API_KEY) {
      candidateModels.push('claude-sonnet-4');
    }
    if (process.env.OPENAI_API_KEY) {
      candidateModels.push('gpt-4o');
    }

    // Ensure at least one fallback model
    if (candidateModels.length === 0) {
      candidateModels.push('gemini-pro');
    }

    try {
      // Try to find a working provider
      let provider;
      for (const model of candidateModels) {
        try {
          provider = await createProvider(model);
          break;
        } catch {
          // Try next model
        }
      }
      if (!provider) {
        throw new Error('No working LLM provider found for planning');
      }

      const systemPrompt = `You are a goal planner for an AI agent system called ClawSwarm.
Your job is to break down a high-level goal into 2-5 concrete, actionable tasks.
Each task should be assigned to the most appropriate specialist agent type.

Available agent types:
- research: Information gathering, analysis, written reports
- code: Writing, reviewing, debugging code
- ops: Infrastructure, deployment, monitoring
- planner: High-level planning and coordination

Rules:
1. Generate 2-5 tasks (not more)
2. Tasks should build on each other logically
3. Specify dependencies where needed
4. Be specific in task descriptions

Respond ONLY with valid JSON matching this exact schema:
{
  "tasks": [
    {
      "title": "Short task title",
      "description": "Detailed description of what to do",
      "agentType": "research|code|ops|planner",
      "dependsOnTitles": ["Title of task this depends on"] // optional, omit if no dependencies
    }
  ]
}`;

      const userPrompt = `Decompose this goal into tasks:

Goal: ${goal.title}
Description: ${goal.description}

Generate a task plan as JSON.`;

      const response = await provider.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { responseFormat: 'json', temperature: 0.3 }
      );

      const parsed = JSON.parse(response.content);
      if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        return parsed.tasks.map((t: {
          title: string;
          description: string;
          agentType: string;
          dependsOnTitles?: string[];
        }) => ({
          title: t.title,
          description: t.description,
          agentType: (t.agentType as AgentType) ?? this._inferPrimaryAgent(goal),
          dependsOnTitles: t.dependsOnTitles,
        }));
      }
    } catch (err) {
      // LLM planning failed — fall back to stub
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[GoalPlanner] LLM planning failed, using fallback plan: ${msg}`);
    }

    return this._fallbackPlan(goal);
  }

  /**
   * Fallback: basic 3-step plan when LLM is unavailable.
   */
  private _fallbackPlan(goal: Goal): PlanStep[] {
    return [
      {
        title: `Research: ${goal.title}`,
        description: `Research and gather background information for: ${goal.description}`,
        agentType: 'research' as AgentType,
      },
      {
        title: `Execute: ${goal.title}`,
        description: `Based on research, implement the core work for: ${goal.description}`,
        agentType: this._inferPrimaryAgent(goal),
        dependsOnTitles: [`Research: ${goal.title}`],
      },
      {
        title: `Review: ${goal.title}`,
        description: `Verify and validate the output for: ${goal.description}`,
        agentType: 'research' as AgentType,
        dependsOnTitles: [`Execute: ${goal.title}`],
      },
    ];
  }

  /**
   * Infer the primary execution agent type from the goal description.
   */
  private _inferPrimaryAgent(goal: Goal): AgentType {
    const desc = `${goal.title} ${goal.description}`.toLowerCase();

    if (/deploy|infrastructure|k8s|docker|ci\/cd|monitoring|server/.test(desc)) {
      return 'ops';
    }
    if (/code|build|implement|function|api|test|debug|refactor/.test(desc)) {
      return 'code';
    }
    if (/research|analyze|report|summarize|find|investigate/.test(desc)) {
      return 'research';
    }

    return 'code'; // default
  }
}

// ─── Goal Manager ─────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of goals in a ClawSwarm instance.
 */
export class GoalManager {
  private goals: Map<string, Goal> = new Map();

  /**
   * Create a new goal.
   */
  create(input: CreateGoalInput): Goal {
    const goal: Goal = {
      ...input,
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'created',
      tasks: [],
      deliverables: [],
      priority: input.priority ?? 0,
      tags: input.tags ?? [],
      cost: {
        totalTokens: 0,
        estimatedCostUsd: 0,
        byAgent: {},
      },
      createdAt: new Date().toISOString(),
    };
    this.goals.set(goal.id, goal);
    return goal;
  }

  /**
   * Get a goal by ID.
   */
  get(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * Get all goals.
   */
  getAll(): Goal[] {
    return Array.from(this.goals.values());
  }

  /**
   * Update a goal's status.
   */
  setStatus(goalId: string, status: GoalStatus): Goal {
    const goal = this._getOrThrow(goalId);
    goal.status = status;
    if (status === 'completed') {
      goal.completedAt = new Date().toISOString();
    }
    return goal;
  }

  /**
   * Attach tasks to a goal.
   */
  setTasks(goalId: string, tasks: Goal['tasks']): Goal {
    const goal = this._getOrThrow(goalId);
    goal.tasks = tasks;
    return goal;
  }

  private _getOrThrow(goalId: string): Goal {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal not found: ${goalId}`);
    return goal;
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface PlanStep {
  title: string;
  description: string;
  agentType: AgentType;
  dependsOnTitles?: string[];
}
