# Agent Configuration and Customization

Agents are the workers in ClawSwarm. This guide covers how to configure built-in agents and create custom ones.

---

## Built-in Agent Types

ClawSwarm ships with four built-in agent types:

### ResearchClaw

Specializes in information gathering, web research, data analysis, and report writing.

```typescript
Agent.research({
  model: 'claude-sonnet-4',
  // Optional overrides:
  name: 'MyResearcher',
  temperature: 0.3,
  maxTokens: 4000,
  systemPrompt: 'Custom instructions...',
})
```

**Default tools:** `web_search`, `web_fetch`, `summarize`

**Best for:** Market research, competitive analysis, fact-finding, report generation

---

### CodeClaw

Specializes in writing, reviewing, debugging, and testing code.

```typescript
Agent.code({
  model: 'gpt-4o',
  tools: ['read_file', 'write_file', 'execute_code', 'run_tests'],
})
```

**Default tools:** `read_file`, `write_file`, `execute_code`, `run_tests`

**Best for:** Feature implementation, bug fixes, refactoring, code review

---

### OpsClaw

Specializes in infrastructure, deployment, monitoring, and cloud operations.

```typescript
Agent.ops({
  model: 'gemini-pro',
  tools: ['shell', 'docker', 'kubernetes', 'monitoring'],
})
```

**Default tools:** `shell`, `docker`, `kubernetes`, `monitoring`

**Best for:** Deployments, CI/CD, infrastructure-as-code, incident response

---

### Planner

The Planner is a special agent that decomposes goals into tasks. It runs automatically — you don't instantiate it directly.

```typescript
Agent.planner({ model: 'claude-opus-4' })
// Registers a custom planner model
```

---

## AgentConfig Reference

All factory methods accept `AgentConfig`:

```typescript
interface AgentConfig {
  type: 'research' | 'code' | 'ops' | 'planner' | 'custom';
  model: ModelId;          // LLM model to use
  name?: string;           // Display name (optional)
  systemPrompt?: string;   // Override the default system prompt
  maxTokens?: number;      // Max tokens per request
  temperature?: number;    // 0.0 (precise) to 1.0 (creative)
  tools?: string[];        // List of tool names this agent can use
}
```

---

## Custom Agents

Extend the `Agent` base class to create custom agents with specialized logic.

### Minimal Custom Agent

```typescript
import { Agent, Task, Deliverable } from '@clawswarm/core';

class SlackAgent extends Agent {
  constructor() {
    super({
      type: 'custom',
      name: 'SlackClaw',
      model: 'claude-sonnet-4',
      tools: ['send_slack_message', 'read_channel'],
      systemPrompt: 'You post updates to Slack channels.',
    });
  }

  override async execute(task: Task): Promise<Deliverable[]> {
    // Your custom logic here
    const message = await this.formatMessage(task);
    await this.postToSlack(message);
    
    return [{
      type: 'text',
      label: 'Slack Message Sent',
      content: message,
    }];
  }

  private async formatMessage(task: Task): Promise<string> {
    return `*${task.title}*\n${task.description}`;
  }

  private async postToSlack(message: string): Promise<void> {
    // Call Slack API
    console.log('Posting to Slack:', message);
  }
}
```

### Restricting Task Types

Override `canHandle()` to make your agent selective:

```typescript
override canHandle(task: Task): boolean {
  // Only handle tasks with 'slack' in the title/description
  return /slack|notification|message/i.test(task.title + task.description);
}
```

### Custom System Prompt

```typescript
class LegalReviewAgent extends Agent {
  constructor() {
    super({
      type: 'custom',
      name: 'LegalClaw',
      model: 'claude-opus-4',
      temperature: 0.1, // very low — legal content needs precision
      systemPrompt: `You are LegalClaw, a legal review specialist.
You review documents for legal compliance, flag potential issues,
and suggest improvements. You are NOT a licensed attorney — always
recommend professional legal counsel for binding decisions.`,
    });
  }
}
```

### Using Multiple Agents of the Same Type

If you register multiple `custom` agents, ClawSwarm uses the last-registered one for routing. For more granular routing, use task `dependsOn` to sequence work:

```typescript
const swarm = new ClawSwarm({
  agents: [
    myFrontendAgent.config,
    myBackendAgent.config,
  ],
});
```

---

## Model Selection Guide

| Use Case | Recommended Model |
|----------|------------------|
| Complex reasoning, analysis | `claude-opus-4`, `gpt-4o` |
| Balanced speed/quality | `claude-sonnet-4`, `gpt-4o-mini` |
| Fast, lightweight tasks | `gemini-flash`, `gpt-4o-mini` |
| Code generation | `gpt-4o`, `claude-sonnet-4` |
| Long documents | `claude-opus-4` (200k context) |

---

## Agent Status

Agents have a `status` field that updates as they work:

```typescript
type AgentStatus = 'idle' | 'busy' | 'error' | 'offline';
```

Access it via:

```typescript
const agent = swarm.getAgent('research');
console.log(agent?.status); // 'idle' | 'busy' | ...
```

Status changes are also broadcast over the bridge if you're using `@clawswarm/bridge`.
