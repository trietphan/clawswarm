/**
 * Base Agent class and specialist agent factories.
 * @module @clawswarm/core/agent
 */

import { AgentConfig, AgentStatus, AgentType, ModelId, Task, Deliverable } from './types.js';
import { createProvider } from './providers/index.js';
import type { LLMProvider } from './providers/types.js';

// ─── Agent Base Class ─────────────────────────────────────────────────────────

/**
 * Base class for all ClawSwarm agents.
 * Extend this to create custom specialist agents.
 *
 * @example
 * ```typescript
 * class MyCustomAgent extends Agent {
 *   async execute(task: Task): Promise<Deliverable[]> {
 *     // your custom logic here
 *     return [{ type: 'text', label: 'Output', content: '...' }];
 *   }
 * }
 * ```
 */
export class Agent {
  public readonly id: string;
  public readonly config: AgentConfig;
  public status: AgentStatus = 'idle';
  public currentTaskId?: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.id = `agent-${config.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /** Agent's display name */
  get name(): string {
    return this.config.name ?? this._defaultName(this.config.type);
  }

  /** Agent's specialization type */
  get type(): AgentType {
    return this.config.type;
  }

  /**
   * Execute a task and return deliverables.
   * Uses the configured LLM provider to complete the task.
   *
   * @param task - The task to execute
   * @returns Array of deliverables produced
   */
  async execute(task: Task): Promise<Deliverable[]> {
    let provider: LLMProvider;
    try {
      provider = await createProvider(this.config.model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Agent "${this.name}" cannot create LLM provider for model "${this.config.model}": ${msg}`);
    }

    // Build context from dependency outputs (if any)
    const dependencyContext = this._buildDependencyContext(task);

    // Build messages
    const messages = [
      {
        role: 'system' as const,
        content: this.getSystemPrompt(),
      },
      {
        role: 'user' as const,
        content: this._buildUserPrompt(task, dependencyContext),
      },
    ];

    let response;
    try {
      response = await provider.chat(messages, {
        model: this.config.model,
        temperature: this.config.temperature ?? 0.7,
        maxTokens: this.config.maxTokens ?? 8192,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Agent "${this.name}" LLM call failed for task "${task.title}": ${msg}`);
    }

    const content = response.content.trim();

    // Determine deliverable type based on agent type
    const deliverableType = this._inferDeliverableType(content);

    return [
      {
        type: deliverableType,
        label: `${this.name} — ${task.title}`,
        content,
      },
    ];
  }

  /**
   * Check if this agent can handle a given task type.
   * Override to restrict which tasks this agent accepts.
   */
  canHandle(_task: Task): boolean {
    return true;
  }

  /**
   * Get the system prompt for this agent.
   * Override to customize the agent's behavior.
   */
  getSystemPrompt(): string {
    return this.config.systemPrompt ?? this._defaultSystemPrompt(this.config.type);
  }

  // ─── Factory Methods ─────────────────────────────────────────────────────────

  /**
   * Create a ResearchClaw agent.
   * Specializes in information gathering, analysis, and written reports.
   */
  static research(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig {
    return {
      type: 'research',
      name: 'ResearchClaw',
      tools: ['web_search', 'web_fetch', 'summarize'],
      ...options,
    };
  }

  /**
   * Create a CodeClaw agent.
   * Specializes in writing, reviewing, and debugging code.
   */
  static code(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig {
    return {
      type: 'code',
      name: 'CodeClaw',
      tools: ['read_file', 'write_file', 'execute_code', 'run_tests'],
      ...options,
    };
  }

  /**
   * Create an OpsClaw agent.
   * Specializes in infrastructure, deployment, and monitoring.
   */
  static ops(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig {
    return {
      type: 'ops',
      name: 'OpsClaw',
      tools: ['shell', 'docker', 'kubernetes', 'monitoring'],
      ...options,
    };
  }

  /**
   * Create a Planner agent.
   * Decomposes goals into tasks and assigns them to specialist agents.
   */
  static planner(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig {
    return {
      type: 'planner',
      name: 'Planner',
      tools: [],
      ...options,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private _buildUserPrompt(task: Task, dependencyContext: string): string {
    const parts: string[] = [
      `Task: ${task.title}`,
      `Description: ${task.description}`,
    ];

    if (dependencyContext) {
      parts.push('');
      parts.push('## Context from previous tasks:');
      parts.push(dependencyContext);
    }

    parts.push('');
    parts.push('Please complete this task thoroughly and provide your full output.');

    return parts.join('\n');
  }

  private _buildDependencyContext(_task: Task): string {
    // Task.dependsOn contains task IDs; the deliverables are already on the task.
    // The swarm can enrich task.description with dependency context before calling execute().
    return '';
  }

  private _inferDeliverableType(content: string): Deliverable['type'] {
    if (this.config.type === 'code') return 'code';
    // Detect code blocks
    if (/```[\w]*\n/.test(content) && this.config.type !== 'research') return 'code';
    return 'text';
  }

  private _defaultName(type: AgentType): string {
    const names: Record<AgentType, string> = {
      research: 'ResearchClaw',
      code: 'CodeClaw',
      ops: 'OpsClaw',
      planner: 'Planner',
      custom: 'CustomAgent',
    };
    return names[type] ?? 'Agent';
  }

  private _defaultSystemPrompt(type: AgentType): string {
    const prompts: Record<AgentType, string> = {
      research: `You are ResearchClaw, a specialist research agent. 
Your job is to gather information, analyze data, synthesize findings, and produce clear written reports.
Always cite your sources. Prioritize accuracy over speed. Flag uncertainty explicitly.`,

      code: `You are CodeClaw, a specialist software engineering agent.
Your job is to write clean, well-tested, production-ready code.
Follow best practices for the language/framework. Write tests. Document your code.
Never ship broken code.`,

      ops: `You are OpsClaw, a specialist infrastructure and operations agent.
Your job is to deploy, monitor, and optimize systems.
Prefer idempotent operations. Document every change. Always have a rollback plan.`,

      planner: `You are the Planner, responsible for decomposing high-level goals into concrete tasks.
Break goals into the smallest meaningful units of work.
Assign each task to the most appropriate specialist agent.
Identify dependencies between tasks and sequence them correctly.`,

      custom: `You are a custom ClawSwarm agent. Follow your configured instructions.`,
    };
    return prompts[type] ?? prompts.custom;
  }
}
