/**
 * Utility exports for ClawSwarm core.
 * @module @clawswarm/core/utils
 */

export { withTimeout, withRetry, LLMTimeoutError } from './timeout.js';
export type { } from './timeout.js';
export { ResultStore, DeliverableStore } from './result-store.js';
export type { PersistedTaskState, PersistedGoalState, StoredResult } from './result-store.js';

// New retry utility (more feature-rich than the one in timeout.ts)
export { withRetry as withSmartRetry, isRetryable } from './retry.js';
export type { RetryOptions } from './retry.js';

// Model router
export { chatWithFallback, getFallbackChain, MODEL_FALLBACKS, isRateLimitError } from './model-router.js';
