# API Reference

Full API reference for `@clawswarm/core` and `@clawswarm/bridge`.

---

## @clawswarm/core

### `ClawSwarm`

The main orchestrator class.

```typescript
class ClawSwarm extends EventEmitter<SwarmEvents> {
  constructor(config: SwarmConfig)

  // Goal management
  createGoal(input: CreateGoalInput): Goal
  execute(goal: Goal): Promise<GoalResult>

  // Agent access
  getAgent(type: AgentType): Agent | undefined
  listAgents(): Agent[]

  // Internal access
  getReviewer(): ChiefReviewer
  getTaskManager(): TaskManager
}
```

#### `ClawSwarm` Events

| Event | Signature | When |
|-------|-----------|------|
| `goal:created` | `(goal: Goal)` | Goal created |
| `goal:planning` | `(goal: Goal)` | Planning started |
| `goal:completed` | `(goal: Goal)` | All tasks done |
| `goal:failed` | `(goal: Goal, error: Error)` | Unrecoverable error |
| `task:assigned` | `(task: Task, agentType: AgentType)` | Agent assigned |
| `task:started` | `(task: Task)` | Execution started |
| `task:completed` | `(task: Task)` | Task submitted for review |
| `task:review` | `(task: Task, review: ReviewResult)` | Review completed |
| `task:rejected` | `(task: Task, review: ReviewResult)` | Task rejected |
| `task:rework` | `(task: Task, review: ReviewResult)` | Rework cycle started |
| `task:failed` | `(task: Task, error: Error)` | Unexpected error |
| `human:review_required` | `(task: Task, review: ReviewResult)` | Human review needed |

---

### `Agent`

Base agent class and factory.

```typescript
class Agent {
  readonly id: string
  readonly config: AgentConfig
  status: AgentStatus
  currentTaskId?: string

  constructor(config: AgentConfig)

  get name(): string
  get type(): AgentType

  execute(task: Task): Promise<Deliverable[]>   // override in custom agents
  canHandle(task: Task): boolean                 // override to filter tasks
  getSystemPrompt(): string                      // override for custom prompts

  // Factory methods
  static research(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig
  static code(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig
  static ops(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig
  static planner(options: Partial<AgentConfig> & { model: ModelId }): AgentConfig
}
```

---

### `GoalManager`

Manages goal lifecycle.

```typescript
class GoalManager {
  create(input: CreateGoalInput): Goal
  get(goalId: string): Goal | undefined
  getAll(): Goal[]
  setStatus(goalId: string, status: GoalStatus): Goal
  setTasks(goalId: string, tasks: Task[]): Goal
}
```

---

### `GoalPlanner`

Decomposes goals into tasks.

```typescript
class GoalPlanner {
  constructor(config: SwarmConfig)
  decompose(goal: Goal, taskManager: TaskManager): Promise<Task[]>
}
```

---

### `TaskManager`

Manages task lifecycle.

```typescript
class TaskManager {
  create(input: Omit<Task, 'id' | 'status' | ...>): Task
  get(taskId: string): Task | undefined
  getAll(): Task[]
  getByGoal(goalId: string): Task[]
  getReady(goalId: string): Task[]   // tasks with all deps completed

  // State transitions
  assign(taskId: string, agentType: AgentType): Task
  start(taskId: string): Task
  submitForReview(taskId: string, deliverables: Deliverable[]): Task
  approve(taskId: string): Task
  complete(taskId: string): Task
  rework(taskId: string, feedback: string): Task  // throws if max exceeded
  reject(taskId: string, reason: string): Task
  fail(taskId: string, error: Error): Task

  isGoalDone(goalId: string): boolean
}
```

---

### `ChiefReviewer`

Reviews task deliverables.

```typescript
class ChiefReviewer extends EventEmitter {
  constructor(config?: ChiefReviewConfig)

  review(task: Task): Promise<ReviewResult>
  scoreToDecision(score: number): 'approved' | 'human_review' | 'rejected'

  get config(): Required<ChiefReviewConfig>
}
```

---

### Types

#### `SwarmConfig`

```typescript
interface SwarmConfig {
  agents: AgentConfig[]
  chiefReview?: ChiefReviewConfig
  bridgeUrl?: string
  orgId?: string
  maxConcurrentGoals?: number
}
```

#### `AgentConfig`

```typescript
interface AgentConfig {
  type: AgentType           // 'research' | 'code' | 'ops' | 'planner' | 'custom'
  model: ModelId
  name?: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  tools?: string[]
}
```

#### `ChiefReviewConfig`

```typescript
interface ChiefReviewConfig {
  autoApproveThreshold?: number   // default: 8
  humanReviewThreshold?: number   // default: 5
  reviewerModel?: ModelId
  criteria?: string[]
}
```

#### `Goal`

```typescript
interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus      // 'created' | 'planning' | 'in_progress' | 'completed' | 'failed'
  tasks: Task[]
  deliverables: Deliverable[]
  priority?: number
  deadline?: string
  tags?: string[]
  cost: CostSummary
  createdAt: string
  completedAt?: string
}
```

#### `Task`

```typescript
interface Task {
  id: string
  goalId: string
  title: string
  description: string
  status: TaskStatus
  assignedTo?: AgentType
  deliverables: Deliverable[]
  reworkCount: number
  maxReworkCycles: number
  dependsOn: string[]
  createdAt: string
  updatedAt: string
}
```

#### `Deliverable`

```typescript
interface Deliverable {
  type: 'text' | 'code' | 'file' | 'url' | 'data'
  label: string
  content: string
  mimeType?: string
  filePath?: string
}
```

#### `ReviewResult`

```typescript
interface ReviewResult {
  taskId: string
  score: number
  decision: 'approved' | 'human_review' | 'rejected'
  feedback: string
  issues: string[]
  suggestions: string[]
  reviewedAt: string
}
```

#### `GoalResult`

```typescript
interface GoalResult {
  goal: Goal
  deliverables: Deliverable[]
  cost: CostSummary
  hadHumanReview: boolean
  durationMs: number
}
```

---

## @clawswarm/bridge

### `BridgeServer`

WebSocket server for real-time communication.

```typescript
class BridgeServer extends EventEmitter<BridgeServerEvents> {
  constructor(config?: BridgeServerConfig)

  start(): Promise<void>
  stop(): Promise<void>

  send(clientId: string, message: BridgeMessage): boolean
  broadcast(orgId: string, message: BridgeMessage, roles?: ClientRole[]): number

  getClients(orgId?: string): BridgeClient[]
  stats(): { connections: number; orgs: number; uptime: boolean }
}
```

#### `BridgeServer` Events

| Event | Signature |
|-------|-----------|
| `listening` | `(port: number, host: string)` |
| `client:connected` | `(client: BridgeClient)` |
| `client:disconnected` | `(clientId: string, reason: string)` |
| `client:authenticated` | `(client: BridgeClient)` |
| `message:received` | `(client: BridgeClient, message: BridgeMessage)` |
| `message:sent` | `(clientId: string, message: BridgeMessage)` |
| `error` | `(error: Error)` |

---

### `TaskRouter`

Routes ClawSwarm events to bridge clients.

```typescript
class TaskRouter {
  constructor(bridge: BridgeServer)

  routeTaskEvent(type: BridgeMessageType, goalId: string, payload: unknown, orgId: string): number
  routeGoalEvent(type: BridgeMessageType, payload: unknown, orgId: string): number
  routeAgentStatus(agentId: string, agentType: string, status: string, orgId: string, currentTaskId?: string): number

  broadcast(orgId: string, message: BridgeMessage, roles?: ClientRole[]): number

  addRule(id: string, rule: RoutingRule): void
  removeRule(id: string): boolean
  route(orgId: string, message: BridgeMessage): number
}
```

---

### Bridge Types

#### `BridgeServerConfig`

```typescript
interface BridgeServerConfig {
  port?: number           // default: 8787
  host?: string           // default: '0.0.0.0'
  maxConnections?: number // default: 1000
  pingIntervalMs?: number // default: 30000
  authTokens?: string[]   // empty = no auth
  path?: string           // default: '/'
}
```

#### `BridgeMessage`

```typescript
interface BridgeMessage<T = unknown> {
  type: BridgeMessageType
  ts: string
  orgId?: string
  payload: T
  correlationId?: string
}
```

#### `BridgeClient`

```typescript
interface BridgeClient {
  id: string
  orgId: string
  role: 'agent' | 'dashboard' | 'external'
  connectedAt: string
  lastPingAt?: string
  authenticated: boolean
  metadata: Record<string, string>
}
```
