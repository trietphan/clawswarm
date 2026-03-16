# Chief Review — The Quality Gate

The Chief Review pipeline ensures that every piece of agent-produced work meets a defined quality standard before being accepted as a deliverable.

---

## How It Works

After every agent completes a task, its output is automatically reviewed by the `ChiefReviewer`. The reviewer (an LLM) evaluates the deliverables against a rubric and produces a score.

```
Task completed
      ↓
ChiefReviewer.review(task)
      ↓
Score 0-10
      ↓
┌─────────────────────────────────────────┐
│ score ≥ autoApproveThreshold (default 8) → ✅ approved  │
│ score ≥ humanReviewThreshold (default 5) → 👀 human     │
│ score < humanReviewThreshold             → ❌ rejected   │
└─────────────────────────────────────────┘
```

---

## Review Criteria

The default criteria (each scored 0-10, then averaged):

1. **completeness** — Does the output fully address all task requirements?
2. **accuracy** — Is the information factually correct and well-sourced?
3. **quality** — Is the output production-ready (no TODOs, no placeholders)?
4. **clarity** — Is it clear, well-structured, and easy to understand?
5. **safety** — Does it avoid harmful, biased, or inappropriate content?

---

## Review Result

Each review produces a `ReviewResult`:

```typescript
interface ReviewResult {
  taskId: string;
  score: number;               // 0-10
  decision: 'approved' | 'human_review' | 'rejected';
  feedback: string;            // 2-3 sentence summary
  issues: string[];            // specific problems found
  suggestions: string[];       // how to improve
  reviewedAt: string;          // ISO timestamp
}
```

---

## Configuration

### Basic Configuration

```typescript
const swarm = new ClawSwarm({
  agents: [...],
  chiefReview: {
    autoApproveThreshold: 8,       // default: 8
    humanReviewThreshold: 5,       // default: 5
    reviewerModel: 'claude-opus-4', // default: 'claude-sonnet-4'
  },
});
```

### Custom Criteria

```typescript
chiefReview: {
  autoApproveThreshold: 9,
  humanReviewThreshold: 7,
  criteria: [
    'correctness: Is every factual claim accurate and verifiable?',
    'completeness: Are ALL specified requirements addressed?',
    'style: Does the output follow our brand voice guidelines?',
    'citations: Are all sources properly cited in APA format?',
    'security: Does the code follow OWASP security guidelines?',
  ],
}
```

### Strict Mode (high thresholds)

```typescript
chiefReview: {
  autoApproveThreshold: 9,   // Only top-tier work auto-approved
  humanReviewThreshold: 7,   // Wide human review band
  reviewerModel: 'claude-opus-4',  // Use the most capable reviewer
}
```

### Lenient Mode (low thresholds)

```typescript
chiefReview: {
  autoApproveThreshold: 6,
  humanReviewThreshold: 3,
}
```

---

## Handling Human Review

When a task scores in the human review band, a `human:review_required` event fires:

```typescript
swarm.on('human:review_required', async (task, review) => {
  console.log('👀 Human review needed:', task.title);
  console.log('Score:', review.score, '— Feedback:', review.feedback);

  // Send to Slack
  await slack.chat.postMessage({
    channel: '#agent-reviews',
    text: `Task needs review: *${task.title}*\nScore: ${review.score}/10\n${review.feedback}`,
  });

  // In the default flow, human_review is treated as approved after the event.
  // Override this by replacing the orchestration logic in your subclass.
});
```

### Custom Human Review Flow

For a blocking human review flow, subclass `ClawSwarm` and override `_handleReview()`:

```typescript
class MySwarm extends ClawSwarm {
  protected override async _handleReview(task, review) {
    if (review.decision === 'human_review') {
      // Wait for a human to approve/reject via an external system
      const decision = await this.waitForHumanDecision(task.id);
      if (decision === 'approve') {
        this.getTaskManager().approve(task.id);
        this.getTaskManager().complete(task.id);
      } else {
        this.getTaskManager().reject(task.id, decision.reason);
      }
    } else {
      await super._handleReview(task, review);
    }
  }
}
```

---

## Rework Cycles

When a task is rejected, it automatically enters a rework cycle:

1. The review's `feedback` is appended to the task's deliverables as a "Rework Feedback" entry
2. The agent re-executes the task, now with the feedback in context
3. Each rework increments `task.reworkCount`
4. After `maxReworkCycles` (default 3), the task is hard-rejected

```typescript
swarm.on('task:rework', (task, review) => {
  console.log(`Rework #${task.reworkCount}/${task.maxReworkCycles}:`, review.feedback);
});
```

---

## Standalone ChiefReviewer

You can use `ChiefReviewer` independently of the full swarm:

```typescript
import { ChiefReviewer } from '@clawswarm/core';

const reviewer = new ChiefReviewer({
  autoApproveThreshold: 8,
  humanReviewThreshold: 5,
});

const result = await reviewer.review(task);
console.log(result.decision, result.score, result.feedback);

// Check thresholds
console.log(reviewer.scoreToDecision(7)); // 'human_review'
console.log(reviewer.config);
```

---

## Connecting a Real LLM

The default `ChiefReviewer` uses a heuristic stub for scoring. To connect a real LLM, override `_callReviewerLLM()` in a subclass:

```typescript
import { ChiefReviewer, Task } from '@clawswarm/core';
import Anthropic from '@anthropic-ai/sdk';

class AnthropicChiefReviewer extends ChiefReviewer {
  private client = new Anthropic();

  protected override async _callReviewerLLM(task: Task) {
    const prompt = this._buildPrompt(task); // public in production
    const response = await this.client.messages.create({
      model: this.config.reviewerModel,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    return JSON.parse((response.content[0] as any).text);
  }
}
```
