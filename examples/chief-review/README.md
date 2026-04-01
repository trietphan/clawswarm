# Chief Review Example

Demonstrates how to customize ClawSwarm's quality gate — the Chief Reviewer — including strict vs. lenient thresholds, custom review criteria, and handling human-review-required tasks.

## What You'll Learn

- Configuring `autoApproveThreshold` and `humanReviewThreshold` for different strictness levels
- Adding custom review `criteria` (correctness, completeness, citations, etc.)
- Choosing a dedicated `reviewerModel` for higher-quality reviews
- Collecting tasks that need human approval via a review queue
- Using the standalone `ChiefReviewer` class outside a swarm
- Understanding the score → decision mapping (approved / human_review / rejected)

## Scenarios Covered

1. **Strict Review** — High thresholds (9/10 to auto-approve) with custom criteria and a powerful reviewer model
2. **Lenient Review** — Low thresholds (6/10 to auto-approve) for quick, low-stakes tasks
3. **Standalone ChiefReviewer** — Using the reviewer class directly to inspect score-to-decision mappings

## Prerequisites

- Node.js 18+
- At least one LLM API key

## Setup

```bash
# From the repo root
cp .env.example .env
# Fill in your API keys in .env
```

## Run

```bash
npx tsx examples/chief-review/index.ts
```

## Expected Output

You'll see tasks reviewed at different strictness levels, with some auto-approved, some flagged for human review, and the standalone reviewer demonstrating the threshold logic.
