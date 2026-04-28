/**
 * Aggregate barrel for the official-API type domain split.
 *
 * All types here mirror `@anthropic-ai/claude-agent-sdk` verbatim.
 * Source of truth: ./official.d.ts (a copy of the official .d.ts).
 *
 * Phase 1 (this commit): types only — no runtime wiring.
 * Phase 2+ will start consuming these from src/index.ts and the engine.
 */
export * from './options.js'
export * from './sdk-message.js'
export * from './permissions.js'
export * from './hooks.js'
export * from './mcp.js'
export * from './agent.js'
export * from './session.js'
export * from './query.js'
