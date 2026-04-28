/**
 * QueryEngine - Core agentic loop
 *
 * Manages the full conversation lifecycle:
 * 1. Take user prompt
 * 2. Build system prompt with context (git status, project context, tools)
 * 3. Call LLM API with tools (via provider abstraction)
 * 4. Stream response
 * 5. Execute tool calls (concurrent for read-only, serial for mutations)
 * 6. Send results back, repeat until done
 * 7. Auto-compact when context exceeds threshold
 * 8. Retry with exponential backoff on transient errors
 */

import type {
  SDKMessage,
  QueryEngineConfig,
  ToolDefinition,
  ToolResult,
  ToolContext,
  TokenUsage,
} from './types.js'
import type {
  LLMProvider,
  CreateMessageResponse,
  NormalizedMessageParam,
  NormalizedTool,
} from './providers/types.js'
import {
  estimateMessagesTokens,
  estimateCost,
  getAutoCompactThreshold,
} from './utils/tokens.js'
import {
  shouldAutoCompact,
  compactConversation,
  microCompactMessages,
  createAutoCompactState,
  type AutoCompactState,
} from './utils/compact.js'
import {
  withRetry,
  isPromptTooLongError,
} from './utils/retry.js'
import { getSystemContext, getUserContext } from './utils/context.js'
import { normalizeMessagesForAPI } from './utils/messages.js'
import type { HookRegistry, HookInput, HookOutput } from './hooks.js'

// ============================================================================
// Tool format conversion
// ============================================================================

/** Convert a ToolDefinition to the normalized provider tool format. */
function toProviderTool(tool: ToolDefinition): NormalizedTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }
}

/**
 * Map an HTTP status to an `SDKAssistantMessageError` literal expected by
 * `SDKAPIRetryMessage.error`. Conservative defaults — anything we can't
 * classify falls back to `'unknown'`.
 */
function classifyApiError(
  status: number | null,
):
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens' {
  if (status === 401 || status === 403) return 'authentication_failed'
  if (status === 402) return 'billing_error'
  if (status === 429) return 'rate_limit'
  if (status !== null && status >= 400 && status < 500) return 'invalid_request'
  if (status !== null && status >= 500) return 'server_error'
  return 'unknown'
}

// ============================================================================
// ToolUseBlock (internal type for extracted tool_use blocks)
// ============================================================================

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: any
}

// ============================================================================
// System Prompt Builder
// ============================================================================

async function buildSystemPrompt(config: QueryEngineConfig): Promise<string> {
  if (config.systemPrompt) {
    const base = config.systemPrompt
    return config.appendSystemPrompt
      ? base + '\n\n' + config.appendSystemPrompt
      : base
  }

  const parts: string[] = []

  parts.push(
    'You are an AI assistant with access to tools. Use the tools provided to help the user accomplish their tasks.',
    'You should use tools when they would help you complete the task more accurately or efficiently.',
  )

  // List available tools with descriptions
  parts.push('\n# Available Tools\n')
  for (const tool of config.tools) {
    parts.push(`- **${tool.name}**: ${tool.description}`)
  }

  // Add agent definitions
  if (config.agents && Object.keys(config.agents).length > 0) {
    parts.push('\n# Available Subagents\n')
    for (const [name, def] of Object.entries(config.agents)) {
      parts.push(`- **${name}**: ${def.description}`)
    }
  }

  // System context (git status, etc.)
  try {
    const sysCtx = await getSystemContext(config.cwd)
    if (sysCtx) {
      parts.push('\n# Environment\n')
      parts.push(sysCtx)
    }
  } catch {
    // Context is best-effort
  }

  // User context (AGENT.md, date)
  try {
    const userCtx = await getUserContext(config.cwd)
    if (userCtx) {
      parts.push('\n# Project Context\n')
      parts.push(userCtx)
    }
  } catch {
    // Context is best-effort
  }

  // Working directory
  parts.push(`\n# Working Directory\n${config.cwd}`)

  if (config.appendSystemPrompt) {
    parts.push('\n' + config.appendSystemPrompt)
  }

  return parts.join('\n')
}

// ============================================================================
// QueryEngine
// ============================================================================

export class QueryEngine {
  private config: QueryEngineConfig
  private provider: LLMProvider
  public messages: NormalizedMessageParam[] = []
  private totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
  private totalCost = 0
  private turnCount = 0
  private compactState: AutoCompactState
  private sessionId: string
  private apiTimeMs = 0
  private hookRegistry?: HookRegistry

  constructor(config: QueryEngineConfig) {
    this.config = config
    this.provider = config.provider
    this.compactState = createAutoCompactState()
    this.sessionId = config.sessionId || crypto.randomUUID()
    this.hookRegistry = config.hookRegistry
  }

  /**
   * Execute hooks for a lifecycle event.
   * Returns { outputs, events } so callers can yield official-shape
   * `SDKHookStartedMessage` / `SDKHookResponseMessage` envelopes around the
   * hook execution. Never throws — hook errors are swallowed and surfaced
   * via the returned events with `outcome: 'error'`.
   */
  private async executeHooksWithEvents(
    event: import('./hooks.js').HookEvent,
    extra?: Partial<HookInput>,
  ): Promise<{ outputs: HookOutput[]; events: SDKMessage[] }> {
    if (!this.hookRegistry?.hasHooks(event)) return { outputs: [], events: [] }

    const events: SDKMessage[] = []
    const hookId = crypto.randomUUID()

    events.push({
      type: 'system',
      subtype: 'hook_started',
      hook_id: hookId,
      hook_name: event,
      hook_event: event,
      uuid: crypto.randomUUID(),
      session_id: this.sessionId,
    } as unknown as SDKMessage)

    let outputs: HookOutput[] = []
    let outcome: 'success' | 'error' = 'success'
    let errMsg = ''
    try {
      outputs = await this.hookRegistry.execute(event, {
        event,
        sessionId: this.sessionId,
        cwd: this.config.cwd,
        ...extra,
      })
    } catch (err) {
      outcome = 'error'
      errMsg = err instanceof Error ? err.message : String(err)
    }

    events.push({
      type: 'system',
      subtype: 'hook_response',
      hook_id: hookId,
      hook_name: event,
      hook_event: event,
      output: JSON.stringify(outputs),
      stdout: '',
      stderr: errMsg,
      outcome,
      uuid: crypto.randomUUID(),
      session_id: this.sessionId,
    } as unknown as SDKMessage)

    return { outputs, events }
  }

  /**
   * Convenience wrapper for callers that don't want to forward hook events.
   * Returns just the hook outputs. Used in non-streaming code paths
   * (e.g. tool dispatch) where the caller can't yield.
   */
  private async executeHooks(
    event: import('./hooks.js').HookEvent,
    extra?: Partial<HookInput>,
  ): Promise<HookOutput[]> {
    const { outputs } = await this.executeHooksWithEvents(event, extra)
    return outputs
  }

  /**
   * Submit a user message and run the agentic loop.
   * Yields SDKMessage events as the agent works.
   */
  async *submitMessage(
    prompt: string | any[],
  ): AsyncGenerator<SDKMessage> {
    const t0 = performance.now()

    // Hook: SessionStart — yield envelopes around the hook so consumers can
    // observe hook execution as official `SDKHookStarted/Response` events.
    {
      const { events } = await this.executeHooksWithEvents('SessionStart')
      for (const e of events) yield e
    }

    // Hook: UserPromptSubmit
    const { outputs: userHookResults, events: userHookEvents } =
      await this.executeHooksWithEvents('UserPromptSubmit', {
        toolInput: prompt,
      })
    for (const e of userHookEvents) yield e
    // Check if any hook blocks the submission
    if (userHookResults.some((r) => r.block)) {
      yield this.makeResultError(
        t0,
        'error_during_execution',
        ['Blocked by UserPromptSubmit hook'],
      )
      return
    }

    // Add user message
    this.messages.push({ role: 'user', content: prompt as any })

    // Build tool definitions for provider
    const tools = this.config.tools.map(toProviderTool)

    // Build system prompt
    const systemPrompt = await buildSystemPrompt(this.config)

    // Emit init system message — official SDKSystemMessage shape.
    yield {
      type: 'system',
      subtype: 'init',
      session_id: this.sessionId,
      uuid: crypto.randomUUID(),
      cwd: this.config.cwd,
      tools: this.config.tools.map((t) => t.name),
      model: this.config.model,
      mcp_servers: [],
      permissionMode: this.config.permissionMode ?? 'default',
      slash_commands: [],
      output_style: 'default',
      skills: [],
      plugins: [],
      apiKeySource: 'user',
      claude_code_version: this.config.claudeCodeVersion ?? '0.0.0',
      betas: this.config.betas,
    } as unknown as SDKMessage

    // Agentic loop
    let turnsRemaining = this.config.maxTurns
    let budgetExceeded = false
    let maxOutputRecoveryAttempts = 0
    const MAX_OUTPUT_RECOVERY = 3

    while (turnsRemaining > 0) {
      if (this.config.abortSignal?.aborted) break

      // Check budget
      if (this.config.maxBudgetUsd && this.totalCost >= this.config.maxBudgetUsd) {
        budgetExceeded = true
        break
      }

      // Auto-compact if context is too large.
      // Around it we emit PreCompact / PostCompact hook envelopes and a
      // `SDKCompactBoundaryMessage` once the compaction actually succeeds.
      if (shouldAutoCompact(this.messages as any[], this.config.model, this.compactState)) {
        const preTokens = (this.compactState as { lastTokenCount?: number }).lastTokenCount ?? 0
        const compactT0 = performance.now()

        const pre = await this.executeHooksWithEvents('PreCompact')
        for (const e of pre.events) yield e

        try {
          const result = await compactConversation(
            this.provider,
            this.config.model,
            this.messages as any[],
            this.compactState,
          )
          this.messages = result.compactedMessages as NormalizedMessageParam[]
          this.compactState = result.state

          // Official SDKCompactBoundaryMessage shape
          yield {
            type: 'system',
            subtype: 'compact_boundary',
            compact_metadata: {
              trigger: 'auto',
              pre_tokens: preTokens,
              post_tokens: (result.state as { lastTokenCount?: number }).lastTokenCount ?? 0,
              duration_ms: Math.round(performance.now() - compactT0),
            },
            uuid: crypto.randomUUID(),
            session_id: this.sessionId,
          } as unknown as SDKMessage

          const post = await this.executeHooksWithEvents('PostCompact')
          for (const e of post.events) yield e
        } catch {
          // Continue with uncompacted messages
        }
      }

      // Micro-compact: truncate large tool results
      const apiMessages = microCompactMessages(
        normalizeMessagesForAPI(this.messages as any[]),
      ) as NormalizedMessageParam[]

      this.turnCount++
      turnsRemaining--

      // Make API call with retry via provider.
      // Each retry produces an SDKAPIRetryMessage (yielded once the call
      // resolves so causality stays intact).
      let response: CreateMessageResponse
      const apiStart = performance.now()
      const retryEvents: SDKMessage[] = []
      try {
        response = await withRetry(
          async () => {
            return this.provider.createMessage({
              model: this.config.model,
              maxTokens: this.config.maxTokens,
              system: systemPrompt,
              messages: apiMessages,
              tools: tools.length > 0 ? tools : undefined,
              thinking:
                this.config.thinking?.type === 'enabled' &&
                this.config.thinking.budgetTokens
                  ? {
                      type: 'enabled',
                      budget_tokens: this.config.thinking.budgetTokens,
                    }
                  : undefined,
            })
          },
          undefined,
          this.config.abortSignal,
          (info) => {
            retryEvents.push({
              type: 'system',
              subtype: 'api_retry',
              attempt: info.attempt,
              max_retries: info.maxRetries,
              retry_delay_ms: info.retryDelayMs,
              error_status: info.errorStatus,
              error: classifyApiError(info.errorStatus),
              uuid: crypto.randomUUID(),
              session_id: this.sessionId,
            } as unknown as SDKMessage)
          },
        )
        for (const e of retryEvents) yield e
      } catch (err: any) {
        // Surface the retry attempts before the failure result
        for (const e of retryEvents) yield e
        // Handle prompt-too-long by compacting
        if (isPromptTooLongError(err) && !this.compactState.compacted) {
          try {
            const result = await compactConversation(
              this.provider,
              this.config.model,
              this.messages as any[],
              this.compactState,
            )
            this.messages = result.compactedMessages as NormalizedMessageParam[]
            this.compactState = result.state
            turnsRemaining++ // Retry this turn
            this.turnCount--
            continue
          } catch {
            // Can't compact, give up
          }
        }

        yield this.makeResultError(t0, 'error_during_execution', [
          err instanceof Error ? err.message : String(err),
        ])
        return
      }

      // Track API timing
      this.apiTimeMs += performance.now() - apiStart

      // Track usage (normalized by provider)
      if (response.usage) {
        this.totalUsage.input_tokens += response.usage.input_tokens
        this.totalUsage.output_tokens += response.usage.output_tokens
        if (response.usage.cache_creation_input_tokens) {
          this.totalUsage.cache_creation_input_tokens =
            (this.totalUsage.cache_creation_input_tokens || 0) +
            response.usage.cache_creation_input_tokens
        }
        if (response.usage.cache_read_input_tokens) {
          this.totalUsage.cache_read_input_tokens =
            (this.totalUsage.cache_read_input_tokens || 0) +
            response.usage.cache_read_input_tokens
        }
        this.totalCost += estimateCost(this.config.model, response.usage)
      }

      // Add assistant message to conversation
      this.messages.push({ role: 'assistant', content: response.content as any })

      // Yield assistant message — official SDKAssistantMessage shape.
      // The `message` field is a BetaMessage-compatible object (id/role/type/
      // content/model/stop_reason/stop_sequence/usage). We synthesize it from
      // the provider's normalized response.
      yield {
        type: 'assistant',
        uuid: crypto.randomUUID(),
        session_id: this.sessionId,
        parent_tool_use_id: null,
        message: {
          id: 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24),
          type: 'message',
          role: 'assistant',
          model: this.config.model,
          content: response.content as any,
          stop_reason: response.stopReason ?? null,
          stop_sequence: null,
          usage: response.usage ?? {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      } as unknown as SDKMessage

      // Handle max_output_tokens recovery
      if (
        response.stopReason === 'max_tokens' &&
        maxOutputRecoveryAttempts < MAX_OUTPUT_RECOVERY
      ) {
        maxOutputRecoveryAttempts++
        // Add continuation prompt
        this.messages.push({
          role: 'user',
          content: 'Please continue from where you left off.',
        })
        continue
      }

      // Check for tool use
      const toolUseBlocks = response.content.filter(
        (block): block is ToolUseBlock => block.type === 'tool_use',
      )

      if (toolUseBlocks.length === 0) {
        break // No tool calls - agent is done
      }

      // Reset max_output recovery counter on successful tool use
      maxOutputRecoveryAttempts = 0

      // Execute tools (concurrent read-only, serial mutations)
      const toolResults = await this.executeTools(toolUseBlocks)

      // Yield tool results — official shape: encoded as SDKUserMessage with
      // a content array of `tool_result` blocks. The official SDK has no
      // standalone `tool_result` event variant.
      if (toolResults.length > 0) {
        yield {
          type: 'user',
          uuid: crypto.randomUUID(),
          session_id: this.sessionId,
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: toolResults.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.tool_use_id,
              content:
                typeof r.content === 'string'
                  ? r.content
                  : JSON.stringify(r.content),
              is_error: r.is_error ?? false,
            })),
          },
        } as unknown as SDKMessage
      }

      // Add tool results to conversation
      this.messages.push({
        role: 'user',
        content: toolResults.map((r) => ({
          type: 'tool_result' as const,
          tool_use_id: r.tool_use_id,
          content:
            typeof r.content === 'string'
              ? r.content
              : JSON.stringify(r.content),
          is_error: r.is_error,
        })),
      })

      if (response.stopReason === 'end_turn') break
    }

    // Hook: Stop (end of agentic loop)
    {
      const { events } = await this.executeHooksWithEvents('Stop')
      for (const e of events) yield e
    }

    // Hook: SessionEnd
    {
      const { events } = await this.executeHooksWithEvents('SessionEnd')
      for (const e of events) yield e
    }

    // Yield enriched final result — official SDKResultSuccess / SDKResultError shape.
    if (budgetExceeded) {
      yield this.makeResultError(t0, 'error_max_budget_usd', [])
    } else if (turnsRemaining <= 0) {
      yield this.makeResultError(t0, 'error_max_turns', [])
    } else {
      yield this.makeResultSuccess(t0)
    }
  }

  // ----------------------------------------------------------------------
  // Helpers — build official-shape SDKResult* messages.
  // ----------------------------------------------------------------------

  private finalText(): string {
    // Last assistant message's text content, concatenated.
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i] as { role?: string; content?: unknown }
      if (m.role !== 'assistant') continue
      if (Array.isArray(m.content)) {
        return (m.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
      }
      if (typeof m.content === 'string') return m.content
    }
    return ''
  }

  private makeResultSuccess(t0: number): SDKMessage {
    return {
      type: 'result',
      subtype: 'success',
      duration_ms: Math.round(performance.now() - t0),
      duration_api_ms: Math.round(this.apiTimeMs),
      is_error: false,
      num_turns: this.turnCount,
      result: this.finalText(),
      stop_reason: null,
      total_cost_usd: this.totalCost,
      usage: {
        input_tokens: this.totalUsage.input_tokens,
        output_tokens: this.totalUsage.output_tokens,
        cache_creation_input_tokens: this.totalUsage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: this.totalUsage.cache_read_input_tokens ?? 0,
      },
      modelUsage: {
        [this.config.model]: {
          inputTokens: this.totalUsage.input_tokens,
          outputTokens: this.totalUsage.output_tokens,
          cacheReadInputTokens: this.totalUsage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: this.totalUsage.cache_creation_input_tokens ?? 0,
          costUSD: this.totalCost,
          webSearchRequests: 0,
          contextWindow: 200_000,
        },
      },
      permission_denials: [],
      uuid: crypto.randomUUID(),
      session_id: this.sessionId,
    } as unknown as SDKMessage
  }

  private makeResultError(
    t0: number,
    subtype:
      | 'error_during_execution'
      | 'error_max_turns'
      | 'error_max_budget_usd'
      | 'error_max_structured_output_retries',
    errors: string[],
  ): SDKMessage {
    return {
      type: 'result',
      subtype,
      duration_ms: Math.round(performance.now() - t0),
      duration_api_ms: Math.round(this.apiTimeMs),
      is_error: true,
      num_turns: this.turnCount,
      stop_reason: null,
      total_cost_usd: this.totalCost,
      usage: {
        input_tokens: this.totalUsage.input_tokens,
        output_tokens: this.totalUsage.output_tokens,
        cache_creation_input_tokens: this.totalUsage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: this.totalUsage.cache_read_input_tokens ?? 0,
      },
      modelUsage: {
        [this.config.model]: {
          inputTokens: this.totalUsage.input_tokens,
          outputTokens: this.totalUsage.output_tokens,
          cacheReadInputTokens: this.totalUsage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: this.totalUsage.cache_creation_input_tokens ?? 0,
          costUSD: this.totalCost,
          webSearchRequests: 0,
          contextWindow: 200_000,
        },
      },
      permission_denials: [],
      errors,
      uuid: crypto.randomUUID(),
      session_id: this.sessionId,
    } as unknown as SDKMessage
  }

  /**
   * Execute tool calls with concurrency control.
   *
   * Read-only tools run concurrently (up to 10 at a time).
   * Mutation tools run sequentially.
   */
  private async executeTools(
    toolUseBlocks: ToolUseBlock[],
  ): Promise<(ToolResult & { tool_name?: string })[]> {
    const context: ToolContext = {
      cwd: this.config.cwd,
      abortSignal: this.config.abortSignal,
      provider: this.provider,
      model: this.config.model,
      apiType: this.provider.apiType,
      fileStateCache: this.config.fileStateCache,
      contentReplacementState: this.config.contentReplacementState,
    }

    const MAX_CONCURRENCY = parseInt(
      process.env.AGENT_SDK_MAX_TOOL_CONCURRENCY || '10',
    )

    // Partition into read-only (concurrent) and mutation (serial)
    const readOnly: Array<{ block: ToolUseBlock; tool?: ToolDefinition }> = []
    const mutations: Array<{ block: ToolUseBlock; tool?: ToolDefinition }> = []

    for (const block of toolUseBlocks) {
      const tool = this.config.tools.find((t) => t.name === block.name)
      if (tool?.isReadOnly?.()) {
        readOnly.push({ block, tool })
      } else {
        mutations.push({ block, tool })
      }
    }

    const results: (ToolResult & { tool_name?: string })[] = []

    // Execute read-only tools concurrently (batched by MAX_CONCURRENCY)
    for (let i = 0; i < readOnly.length; i += MAX_CONCURRENCY) {
      const batch = readOnly.slice(i, i + MAX_CONCURRENCY)
      const batchResults = await Promise.all(
        batch.map((item) =>
          this.executeSingleTool(item.block, item.tool, context),
        ),
      )
      results.push(...batchResults)
    }

    // Execute mutation tools sequentially
    for (const item of mutations) {
      const result = await this.executeSingleTool(item.block, item.tool, context)
      results.push(result)
    }

    return results
  }

  /**
   * Execute a single tool with permission checking.
   */
  private async executeSingleTool(
    block: ToolUseBlock,
    tool: ToolDefinition | undefined,
    context: ToolContext,
  ): Promise<ToolResult & { tool_name?: string }> {
    if (!tool) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: Unknown tool "${block.name}"`,
        is_error: true,
        tool_name: block.name,
      }
    }

    // Check enabled
    if (tool.isEnabled && !tool.isEnabled()) {
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Error: Tool "${block.name}" is not enabled`,
        is_error: true,
        tool_name: block.name,
      }
    }

    // Check permissions — official CanUseTool signature:
    //   (toolName, input, { signal, toolUseID, agentID? }) => Promise<PermissionResult>
    if (this.config.canUseTool) {
      try {
        const permission = await this.config.canUseTool(
          block.name,
          block.input as Record<string, unknown>,
          {
            signal: this.config.abortSignal ?? new AbortController().signal,
            toolUseID: block.id,
          },
        )
        if (permission.behavior === 'deny') {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: permission.message || `Permission denied for tool "${block.name}"`,
            is_error: true,
            tool_name: block.name,
          }
        }
        if (permission.updatedInput !== undefined) {
          block = { ...block, input: permission.updatedInput }
        }
      } catch (err: any) {
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Permission check error: ${err.message}`,
          is_error: true,
          tool_name: block.name,
        }
      }
    }

    // Hook: PreToolUse
    const preHookResults = await this.executeHooks('PreToolUse', {
      toolName: block.name,
      toolInput: block.input,
      toolUseId: block.id,
    })
    // Check if any hook blocks this tool
    if (preHookResults.some((r) => r.block)) {
      const msg = preHookResults.find((r) => r.message)?.message || 'Blocked by PreToolUse hook'
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: msg,
        is_error: true,
        tool_name: block.name,
      }
    }

    // Execute the tool
    try {
      const result = await tool.call(block.input, context)

      // Hook: PostToolUse
      await this.executeHooks('PostToolUse', {
        toolName: block.name,
        toolInput: block.input,
        toolOutput: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        toolUseId: block.id,
      })

      return { ...result, tool_use_id: block.id, tool_name: block.name }
    } catch (err: any) {
      // Hook: PostToolUseFailure
      await this.executeHooks('PostToolUseFailure', {
        toolName: block.name,
        toolInput: block.input,
        toolUseId: block.id,
        error: err.message,
      })

      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Tool execution error: ${err.message}`,
        is_error: true,
        tool_name: block.name,
      }
    }
  }

  /**
   * Get current messages for session persistence.
   */
  getMessages(): NormalizedMessageParam[] {
    return [...this.messages]
  }

  /**
   * Get total usage across all turns.
   */
  getUsage(): TokenUsage {
    return { ...this.totalUsage }
  }

  /**
   * Get total cost.
   */
  getCost(): number {
    return this.totalCost
  }
}
