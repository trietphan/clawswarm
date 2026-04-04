# ClawSwarm API Reference

Complete reference for the `clawswarm-ai` package. All exports are available from the root package.

```typescript
import { ClawSwarm, Agent, DashboardReporter, BridgeServer } from 'clawswarm-ai';
```

---

## Table of Contents

- [ClawSwarm](#clawswarm)
- [Agent](#agent)
- [DashboardReporter](#dashboardreporter)
- [BridgeServer / Bridge Adapters](#bridgeserver--bridge-adapters)
- [GoalManager & GoalPlanner](#goalmanager--goalplanner)
- [TaskManager](#taskmanager)
- [ChiefReviewer](#chiefreviewer)
- [Utility Functions](#utility-functions)
- [Types Reference](#types-reference)
- [Events Reference](#events-reference)

---

## ClawSwarm

The main orchestrator. Manages agents, goals, and task execution.

```typescript
import { ClawSwarm } from 'clawswarm-ai';

const swarm = new ClawSwarm({
  agents: [
    { type: 'researcher', model: 'gpt-4o', systemPrompt: 'You are a research specialist.' },
    { type: 'writer',     model: 'gpt-4o', systemPrompt: 'You are a writing specialist.' },
  ],
  chiefReview: { enabled: true, threshold: 0.8 },
});
```

### Constructor

```typescript
new ClawSwarm(config: SwarmConfig)
```

#### `SwarmConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agents` | `AgentConfig[]` | ✅ | One or more agent definitions |
| `chiefReview` | `ChiefReviewConfig` | ❌ | Auto-review settings |
| `model` | `ModelId` | ❌ | Default model for the planner |
| `plannerPrompt` | `string` | ❌ | Override planner system prompt |
| `resultsDir` | `string` | ❌ | Where to persist deliverables (default: `.clawswarm/results`) |

#### `AgentConfig`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `AgentType` | ✅ | Agent role (`'researcher'`, `'writer'`, `'coder'`, `'analyst'`, or any string) |
| `model` | `ModelId` | ✅ | LLM model ID (e.g. `'gpt-4o'`, `'claude-opus-4-5'`) |
| `systemPrompt` | `string` | ❌ | Agent persona / instructions |
| `maxRetries` | `number` | ❌ | Max LLM retry attempts |
| `timeoutMs` | `number` | ❌ | Per-step timeout in milliseconds |

### Methods

#### `createGoal(input: CreateGoalInput): Goal`

Creates a goal object without executing it. Use `execute()` to run it.

```typescript
const goal = swarm.createGoal({
  title: 'Research TypeScript best practices',
  description: 'Summarize the top 5 TS patterns for production Node.js services.',
});
```

#### `execute(goal: Goal): Promise<GoalResult>`

Runs a goal end-to-end: planning → task execution → chief review → deliverables.

```typescript
const result = await swarm.execute(goal);

console.log('Deliverables:', result.deliverables);
console.log('Duration:', result.durationMs, 'ms');
console.log('Total tokens:', result.cost.totalTokens);
```

**Returns `GoalResult`:**

| Field | Type | Description |
|-------|------|-------------|
| `goal` | `Goal` | Updated goal with final status |
| `deliverables` | `Deliverable[]` | All task outputs |
| `cost` | `CostSummary` | Token usage and cost |
| `hadHumanReview` | `boolean` | Whether any task escalated to human |
| `durationMs` | `number` | Total wall-clock time |

#### `getAgent(type: AgentType): Agent | undefined`

Look up a registered agent by role.

```typescript
const researcher = swarm.getAgent('researcher');
```

#### `listAgents(): Agent[]`

Returns all registered agents.

#### `getReviewer(): ChiefReviewer`

Access the ChiefReviewer for inspection or custom logic.

#### `getTaskManager(): TaskManager`

Access the TaskManager for direct task inspection.

### Events

`ClawSwarm` extends `EventEmitter<SwarmEvents>`. Listen with `.on()`:

```typescript
swarm.on('goal:created',   (goal)       => console.log('Goal created:', goal.id));
swarm.on('goal:planning',  (goal)       => console.log('Planning...'));
swarm.on('goal:completed', (goal)       => console.log('Done!', goal.id));
swarm.on('goal:failed',    (goal, err)  => console.error('Failed:', err.message));

swarm.on('task:created',   (task)       => console.log('Task:', task.title));
swarm.on('task:completed', (task)       => console.log('✅', task.title));
swarm.on('task:failed',    (task, err)  => console.error('Task failed'));
```

See full [Events Reference](#events-reference) below.

---

## Agent

Individual AI worker. Usually managed by `ClawSwarm`, but can be used standalone.

```typescript
import { Agent } from 'clawswarm-ai';

const agent = new Agent({
  type: 'researcher',
  model: 'gpt-4o',
  systemPrompt: 'You are a research specialist.',
});
```

Agents are registered via `SwarmConfig.agents` — you rarely need to instantiate them directly.

---

## DashboardReporter

Sends lifecycle events from local ClawSwarm runs to the clawswarm.app dashboard. **Opt-in** — a no-op unless `CLAWSWARM_API_KEY` is set. **Fire-and-forget** — never blocks execution, never throws.

```typescript
import { DashboardReporter } from 'clawswarm-ai';
```

### Setup

**Option 1 — Environment variables (recommended):**

```bash
export CLAWSWARM_API_KEY=your_api_key
export CLAWSWARM_DASHBOARD_URL=https://clawswarm.app  # optional
```

```typescript
const reporter = DashboardReporter.fromEnv();
```

**Option 2 — Direct config:**

```typescript
const reporter = new DashboardReporter({
  apiKey: 'your_api_key',
  dashboardUrl: 'https://clawswarm.app',
});
```

### `DashboardReporterConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | `string` | — | Bearer token. Disables reporter if absent. |
| `dashboardUrl` | `string` | `'https://clawswarm.app'` | Base URL of dashboard backend |

### Methods

#### `DashboardReporter.fromEnv(): DashboardReporter` (static)

Creates a reporter from `CLAWSWARM_API_KEY` and `CLAWSWARM_DASHBOARD_URL` env vars.

#### `reporter.isEnabled: boolean`

`true` if an API key is configured and reporting is active.

#### `reporter.runStarted(payload: RunStartedPayload): void`

```typescript
reporter.runStarted({
  runId: 'run-abc123',
  goal: 'Research and summarize TypeScript best practices',
  metadata: { triggeredBy: 'cli', version: '1.2.0' }, // optional
});
```

#### `reporter.runCompleted(payload: RunCompletedPayload): void`

```typescript
reporter.runCompleted({
  runId: 'run-abc123',
  summary: 'Completed with 3 deliverables',
  durationMs: 45000,
  // error: 'timeout' — set on failure
});
```

#### `reporter.taskCreated(payload: TaskCreatedPayload): void`

```typescript
reporter.taskCreated({
  runId: 'run-abc123',
  taskId: 'task-1',
  title: 'Research TypeScript patterns',
  description: 'Deep-dive into generics and conditional types',
  agentRole: 'researcher',
});
```

#### `reporter.taskCompleted(payload: TaskCompletedPayload): void`

```typescript
reporter.taskCompleted({
  runId: 'run-abc123',
  taskId: 'task-1',
  output: 'Here are the top 5 patterns...',
  // error: 'agent timeout' — set on failure
});
```

#### `reporter.stepStarted(payload: StepStartedPayload): void`

```typescript
reporter.stepStarted({
  runId: 'run-abc123',
  stepId: 'step-1',
  taskId: 'task-1',
  agentRole: 'researcher',
});
```

#### `reporter.stepCompleted(payload: StepCompletedPayload): void`

```typescript
reporter.stepCompleted({
  runId: 'run-abc123',
  stepId: 'step-1',
  taskId: 'task-1',
  output: 'Research complete.',
  durationMs: 12000,
  tokenUsage: { input: 800, output: 400, total: 1200 },
});
```

### Full Integration Example

```typescript
import { ClawSwarm, DashboardReporter } from 'clawswarm-ai';
import { randomUUID } from 'crypto';

const reporter = DashboardReporter.fromEnv();
const swarm = new ClawSwarm({ agents: [/* ... */] });

// Wire up events
const runId = randomUUID();

swarm.on('goal:created', (goal) => {
  reporter.runStarted({ runId, goal: goal.title });
});

swarm.on('task:created', (task) => {
  reporter.taskCreated({ runId, taskId: task.id, title: task.title });
});

swarm.on('task:completed', (task) => {
  reporter.taskCompleted({ runId, taskId: task.id });
});

swarm.on('goal:completed', (goal) => {
  reporter.runCompleted({ runId, summary: 'All tasks complete' });
});

swarm.on('goal:failed', (goal, err) => {
  reporter.runCompleted({ runId, error: err.message });
});

const goal = swarm.createGoal({ title: 'Write release notes' });
await swarm.execute(goal);
```

---

## BridgeServer / Bridge Adapters

The bridge layer connects local ClawSwarm execution to MoonClawSwarm (the cloud dashboard).

### BridgeServer

```typescript
import { BridgeServer } from 'clawswarm-ai';

const bridge = new BridgeServer({
  port: 3001,
  secret: process.env.BRIDGE_SECRET,
});
await bridge.start();
```

#### `BridgeServerConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3001` | WebSocket server port |
| `secret` | `string` | — | Shared auth secret |
| `heartbeatMs` | `number` | `30000` | Ping interval |

### ConvexBridgeAdapter

Connects ClawSwarm to a Convex-backed dashboard (MoonClawSwarm):

```typescript
import { ConvexBridgeAdapter } from 'clawswarm-ai';

const adapter = new ConvexBridgeAdapter({
  convexUrl: process.env.CONVEX_URL!,
  bridgeToken: process.env.BRIDGE_SECRET!,
});
```

#### `ConvexAdapterConfig`

| Field | Type | Description |
|-------|------|-------------|
| `convexUrl` | `string` | Convex deployment URL |
| `bridgeToken` | `string` | Bridge auth token |
| `pollIntervalMs` | `number` | How often to poll for pending steps (default: `2000`) |

### DashboardBridge

Higher-level bridge that wraps `ConvexBridgeAdapter` with chief review logic:

```typescript
import { DashboardBridge } from 'clawswarm-ai';

const bridge = new DashboardBridge({
  convexUrl: process.env.CONVEX_URL!,
  bridgeToken: process.env.BRIDGE_SECRET!,
  chiefReview: { enabled: true, threshold: 0.8 },
});
```

---

## GoalManager & GoalPlanner

Internal managers exposed for advanced use cases.

```typescript
import { GoalManager, GoalPlanner } from 'clawswarm-ai';
```

`GoalManager` handles in-memory CRUD for goals. `GoalPlanner` calls the LLM to decompose a goal into tasks. Both are used internally by `ClawSwarm.execute()`.

---

## TaskManager

```typescript
import { TaskManager } from 'clawswarm-ai';
```

Tracks task state within a goal. Exposed via `swarm.getTaskManager()`.

Key methods:
- `getByGoal(goalId)` — all tasks for a goal
- `getReady(goalId)` — tasks whose dependencies are met
- `isGoalDone(goalId)` — true when all tasks are completed or failed

---

## ChiefReviewer

Automatically reviews completed tasks and decides: `approve`, `rework`, or `human_review`.

```typescript
import { ChiefReviewer } from 'clawswarm-ai';
```

Configure via `SwarmConfig.chiefReview`:

#### `ChiefReviewConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable auto-review |
| `threshold` | `number` | `0.8` | Quality score 0–1 required to approve |
| `model` | `ModelId` | — | Model to use for review (falls back to planner model) |
| `maxReworkCycles` | `number` | `3` | Max rework loops before human escalation |

---

## Utility Functions

### `withTimeout<T>(promise, ms, label?): Promise<T>`

Wraps a promise with a timeout. Throws `LLMTimeoutError` on expiry.

```typescript
import { withTimeout, LLMTimeoutError } from 'clawswarm-ai';

try {
  const result = await withTimeout(myLLMCall(), 30_000, 'researcher step');
} catch (err) {
  if (err instanceof LLMTimeoutError) console.error('Timed out!');
}
```

### `withRetry<T>(fn, options?): Promise<T>`

Retries an async function with exponential backoff.

```typescript
import { withRetry } from 'clawswarm-ai';

const result = await withRetry(() => callLLM(), {
  maxAttempts: 3,
  baseDelayMs: 1000,
});
```

### `withSmartRetry<T>(fn, options?): Promise<T>`

Retry with model fallback support. Automatically switches to a cheaper/faster model on rate limits.

```typescript
import { withSmartRetry } from 'clawswarm-ai';

const result = await withSmartRetry(() => callLLM('gpt-4o', prompt), {
  model: 'gpt-4o',
  maxAttempts: 4,
});
```

### `chatWithFallback(model, messages, options?): Promise<string>`

Calls an LLM with automatic fallback chain on rate limit or failure.

```typescript
import { chatWithFallback } from 'clawswarm-ai';

const response = await chatWithFallback('gpt-4o', [
  { role: 'user', content: 'Summarize this text.' }
]);
```

### `getFallbackChain(model): ModelId[]`

Returns the fallback model chain for a given model.

```typescript
import { getFallbackChain, MODEL_FALLBACKS } from 'clawswarm-ai';

console.log(getFallbackChain('gpt-4o'));
// ['gpt-4o-mini', 'gpt-3.5-turbo']

console.log(MODEL_FALLBACKS);
// Map of primary → fallback chain
```

### `ResultStore` / `DeliverableStore`

File-backed persistence for task results.

```typescript
import { ResultStore, DeliverableStore } from 'clawswarm-ai';

const store = new DeliverableStore('./my-results');
await store.save(taskId, content);
const saved = await store.load(taskId);
```

---

## Types Reference

### Goal

```typescript
interface Goal {
  id: string;
  title: string;
  description?: string;
  status: GoalStatus;         // 'pending' | 'planning' | 'in_progress' | 'completed' | 'failed'
  tasks: string[];            // Task IDs
  cost: CostSummary;
  createdAt: number;
  updatedAt: number;
}
```

### Task

```typescript
interface Task {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  agentType: AgentType;
  status: TaskStatus;         // 'pending' | 'in_progress' | 'review' | 'rework' | 'completed' | 'failed'
  deliverables: Deliverable[];
  dependsOn: string[];        // Task IDs this task waits for
  reworkCount: number;
  createdAt: number;
  updatedAt: number;
}
```

### Deliverable

```typescript
interface Deliverable {
  taskId: string;
  content: string;
  type?: string;
  metadata?: Record<string, unknown>;
}
```

### CostSummary

```typescript
interface CostSummary {
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}
```

### ReviewResult

```typescript
interface ReviewResult {
  decision: 'approve' | 'rework' | 'human_review';
  score: number;       // 0.0 – 1.0
  feedback?: string;
}
```

### CreateGoalInput

```typescript
interface CreateGoalInput {
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
```

---

## Events Reference

`ClawSwarm` emits typed events via `EventEmitter<SwarmEvents>`.

### Goal Events

| Event | Payload | Description |
|-------|---------|-------------|
| `goal:created` | `(goal: Goal)` | New goal created via `createGoal()` |
| `goal:planning` | `(goal: Goal)` | Planner started decomposing tasks |
| `goal:completed` | `(goal: Goal)` | All tasks done |
| `goal:failed` | `(goal: Goal, err: Error)` | Goal execution threw |

### Task Events

| Event | Payload | Description |
|-------|---------|-------------|
| `task:created` | `(task: Task)` | New task added by planner |
| `task:started` | `(task: Task)` | Agent picked up the task |
| `task:completed` | `(task: Task)` | Task output accepted by reviewer |
| `task:failed` | `(task: Task, err: Error)` | Task threw or exceeded rework limit |
| `task:rework` | `(task: Task, feedback: string)` | Chief sent task back for revision |

### Usage

```typescript
swarm.on('task:completed', (task) => {
  console.log(`✅ ${task.title}`);
  task.deliverables.forEach(d => console.log(d.content));
});

swarm.on('task:rework', (task, feedback) => {
  console.warn(`🔁 ${task.title} needs rework: ${feedback}`);
});

swarm.on('goal:failed', (goal, err) => {
  console.error(`❌ Goal failed: ${err.message}`);
});
```

---

## Dashboard Event Types

When using `DashboardReporter`, these events are sent to `POST /api/bridge/events`:

| Event Type | Sent By | Description |
|------------|---------|-------------|
| `run.started` | `reporter.runStarted()` | A new run begins |
| `run.completed` | `reporter.runCompleted()` | Run finished (success or error) |
| `task.created` | `reporter.taskCreated()` | Planner emitted a task |
| `task.completed` | `reporter.taskCompleted()` | Task output ready |
| `step.started` | `reporter.stepStarted()` | Agent began a step |
| `step.completed` | `reporter.stepCompleted()` | Step finished with output |

### `DashboardEvent` shape (sent over the wire)

```typescript
interface DashboardEvent {
  type: DashboardEventType;
  timestamp: string;        // ISO 8601
  runId: string;
  taskId?: string;
  stepId?: string;
  data?: Record<string, unknown>;
}
```
