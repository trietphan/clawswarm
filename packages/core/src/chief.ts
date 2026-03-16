/**
 * Chief review pipeline — the quality gate for ClawSwarm.
 *
 * Every task deliverable passes through a 3-tier scoring system:
 *   - Score ≥ autoApproveThreshold (default 8) → auto-approved
 *   - Score ≥ humanReviewThreshold (default 5) → human review required
 *   - Score < humanReviewThreshold             → auto-rejected + rework
 *
 * @module @clawswarm/core/chief
 */

import EventEmitter from 'eventemitter3';
import {
  Task,
  ReviewResult,
  ChiefReviewConfig,
  ModelId,
} from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_AUTO_APPROVE_THRESHOLD = 8;
const DEFAULT_HUMAN_REVIEW_THRESHOLD = 5;
const DEFAULT_REVIEWER_MODEL: ModelId = 'claude-sonnet-4';

const DEFAULT_CRITERIA = [
  'completeness: Does the output fully address the task requirements?',
  'accuracy: Is the information correct and well-sourced?',
  'quality: Is the output production-ready (no TODOs, no placeholders)?',
  'clarity: Is the output clear, well-structured, and easy to understand?',
  'safety: Does the output avoid harmful, biased, or problematic content?',
];

// ─── Chief Reviewer ───────────────────────────────────────────────────────────

/**
 * The Chief Reviewer evaluates task deliverables against a rubric
 * and decides whether to approve, send for human review, or reject.
 *
 * @example
 * ```typescript
 * const reviewer = new ChiefReviewer({
 *   autoApproveThreshold: 8,
 *   humanReviewThreshold: 5,
 *   reviewerModel: 'claude-opus-4',
 *   criteria: ['completeness', 'accuracy', 'quality'],
 * });
 *
 * const result = await reviewer.review(task);
 *
 * if (result.decision === 'approved') {
 *   console.log('✅ Task approved!', result.score);
 * } else if (result.decision === 'human_review') {
 *   console.log('👀 Needs human review', result.feedback);
 * } else {
 *   console.log('❌ Rejected:', result.issues);
 * }
 * ```
 */
export class ChiefReviewer extends EventEmitter {
  private readonly autoApproveThreshold: number;
  private readonly humanReviewThreshold: number;
  private readonly reviewerModel: ModelId;
  private readonly criteria: string[];

  constructor(config: ChiefReviewConfig = {}) {
    super();
    this.autoApproveThreshold = config.autoApproveThreshold ?? DEFAULT_AUTO_APPROVE_THRESHOLD;
    this.humanReviewThreshold = config.humanReviewThreshold ?? DEFAULT_HUMAN_REVIEW_THRESHOLD;
    this.reviewerModel = config.reviewerModel ?? DEFAULT_REVIEWER_MODEL;
    this.criteria = config.criteria ?? DEFAULT_CRITERIA;

    this._validateThresholds();
  }

  /**
   * Review a task and produce a structured ReviewResult.
   *
   * @param task - The task to review (must have deliverables)
   * @returns A ReviewResult with score, decision, and feedback
   */
  async review(task: Task): Promise<ReviewResult> {
    if (task.deliverables.length === 0) {
      return this._buildResult(task.id, 0, [], ['No deliverables were produced by the agent.'], []);
    }

    // In production: call LLM with structured review prompt
    const raw = await this._callReviewerLLM(task);

    const result = this._buildResult(
      task.id,
      raw.score,
      raw.issues,
      raw.suggestions,
      raw.feedback
    );

    this.emit('reviewed', result);
    return result;
  }

  /**
   * Synchronously check what decision would be made for a given score.
   * Useful for dry-runs and testing.
   */
  scoreToDecision(score: number): ReviewResult['decision'] {
    if (score >= this.autoApproveThreshold) return 'approved';
    if (score >= this.humanReviewThreshold) return 'human_review';
    return 'rejected';
  }

  /**
   * Get the current review configuration (read-only).
   */
  get config(): Required<ChiefReviewConfig> {
    return {
      autoApproveThreshold: this.autoApproveThreshold,
      humanReviewThreshold: this.humanReviewThreshold,
      reviewerModel: this.reviewerModel,
      criteria: this.criteria,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Build a review prompt for the LLM.
   * @internal
   */
  private _buildPrompt(task: Task): string {
    const deliverablesSummary = task.deliverables
      .map((d, i) => `[${i + 1}] ${d.label} (${d.type}):\n${d.content.slice(0, 2000)}`)
      .join('\n\n');

    const criteriaList = this.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');

    return `You are a Chief Reviewer for an AI agent system. Your job is to objectively score the quality of agent-produced work.

## Task
Title: ${task.title}
Description: ${task.description}

## Deliverables
${deliverablesSummary}

## Review Criteria (score each 0-10, then average)
${criteriaList}

## Instructions
1. Score each criterion from 0 to 10
2. Identify specific issues (things that are wrong or missing)
3. Provide concrete suggestions for improvement
4. Give an overall score (0-10) and a 2-3 sentence summary

Respond in JSON:
{
  "criteriaScores": { "<criterion>": <score> },
  "overallScore": <number>,
  "issues": ["<issue1>", ...],
  "suggestions": ["<suggestion1>", ...],
  "feedback": "<2-3 sentence summary>"
}`;
  }

  /**
   * Call the LLM reviewer. In production, replace the stub with a real LLM call.
   * @internal
   */
  private async _callReviewerLLM(task: Task): Promise<RawReviewResponse> {
    // ── Production stub ──────────────────────────────────────────────────────
    // Replace this with your actual LLM client call, e.g.:
    //
    //   const response = await openai.chat.completions.create({
    //     model: this.reviewerModel,
    //     messages: [{ role: 'user', content: this._buildPrompt(task) }],
    //     response_format: { type: 'json_object' },
    //   });
    //   return JSON.parse(response.choices[0].message.content!);
    //
    // ────────────────────────────────────────────────────────────────────────

    void this._buildPrompt(task); // reference so it's not dead code

    // Stub: evaluate based on deliverable completeness heuristics
    const hasContent = task.deliverables.some(d => d.content.trim().length > 100);
    const hasTodo = task.deliverables.some(d => /TODO|FIXME|placeholder/i.test(d.content));
    const hasCode = task.deliverables.some(d => d.type === 'code');
    const contentLength = task.deliverables.reduce((sum, d) => sum + d.content.length, 0);

    let score = hasContent ? 7 : 3;
    if (hasTodo) score -= 2;
    if (hasCode && contentLength > 500) score += 1;
    score = Math.max(0, Math.min(10, score));

    const issues: string[] = [];
    const suggestions: string[] = [];

    if (!hasContent) issues.push('Deliverables appear to be empty or too short.');
    if (hasTodo) {
      issues.push('Output contains TODO/FIXME markers — not production-ready.');
      suggestions.push('Complete all TODO items before submitting.');
    }
    if (contentLength < 200) suggestions.push('Expand the output with more detail.');

    return {
      score,
      issues,
      suggestions,
      feedback: issues.length === 0
        ? 'Work looks complete and meets the task requirements.'
        : `Found ${issues.length} issue(s) that need attention before approval.`,
    };
  }

  /**
   * Assemble a ReviewResult from raw LLM data.
   * @internal
   */
  private _buildResult(
    taskId: string,
    score: number,
    issues: string[],
    suggestions: string[],
    feedback: string | string[]
  ): ReviewResult {
    const clampedScore = Math.max(0, Math.min(10, score));
    const feedbackStr = Array.isArray(feedback) ? feedback.join(' ') : feedback;

    return {
      taskId,
      score: clampedScore,
      decision: this.scoreToDecision(clampedScore),
      feedback: feedbackStr,
      issues,
      suggestions,
      reviewedAt: new Date().toISOString(),
    };
  }

  /**
   * Validate that thresholds are logically consistent.
   * @internal
   */
  private _validateThresholds(): void {
    if (this.autoApproveThreshold < this.humanReviewThreshold) {
      throw new Error(
        `ChiefReviewer: autoApproveThreshold (${this.autoApproveThreshold}) must be ` +
        `>= humanReviewThreshold (${this.humanReviewThreshold})`
      );
    }
    if (this.autoApproveThreshold > 10 || this.humanReviewThreshold < 0) {
      throw new Error('ChiefReviewer: thresholds must be between 0 and 10');
    }
  }
}

// ─── Internal Types ───────────────────────────────────────────────────────────

interface RawReviewResponse {
  score: number;
  issues: string[];
  suggestions: string[];
  feedback: string;
}
