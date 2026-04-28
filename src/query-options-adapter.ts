/**
 * Adapter: official `Options` → internal `AgentOptions`.
 *
 * Maps every official field to its internal equivalent where one exists, and
 * records TODOs where Phase 3+ will implement the missing semantics.
 *
 * Non-official extension fields (`apiType`, `baseURL`, `apiKey`) are read off
 * the input as `(options as any).{field}` so the public type stays aligned
 * with the official `Options` while still permitting the OpenAI-compat
 * extension. See plan §2.
 */

import type { Options } from './types/index.js'
import type { AgentOptions } from './types.js'

/**
 * Translate a subset of the official `Options` shape into the internal
 * `AgentOptions` consumed by the existing engine.
 *
 * Phase 2 covers: model, cwd, env, abortController, allowedTools, disallowedTools,
 * mcpServers, agents, permissionMode, canUseTool, hooks, maxTurns, maxBudgetUsd,
 * thinking, includePartialMessages, settingSources, sessionId/title/continue/
 * resume/forkSession/persistSession/enableFileCheckpointing, sandbox, debug/
 * debugFile, betas, plugins, plus the systemPrompt and tools presets.
 *
 * Fields not yet wired through (effort, fallbackModel, taskBudget, onElicitation,
 * settings, managedSettings, skills, loadTimeoutMs, stderr, strictMcpConfig,
 * includeHookEvents, toolConfig, planModeInstructions, permissionPromptToolName,
 * allowDangerouslySkipPermissions, sessionStore, resumeSessionAt,
 * agentProgressSummaries, forwardSubagentText, agent, additionalDirectories)
 * are accepted at the type layer and ignored at runtime; Phase 3+ will pick
 * them up.
 */
export function adaptOptions(options: Options): AgentOptions {
  const ext = options as Options & {
    apiType?: 'anthropic-messages' | 'openai-completions'
    baseURL?: string
    apiKey?: string
  }

  const out: AgentOptions = {}

  // Direct passthroughs ---------------------------------------------------
  if (options.cwd !== undefined) out.cwd = options.cwd
  if (options.env !== undefined) out.env = options.env
  if (options.abortController !== undefined) out.abortController = options.abortController
  if (options.allowedTools !== undefined) out.allowedTools = options.allowedTools
  if (options.disallowedTools !== undefined) out.disallowedTools = options.disallowedTools
  if (options.permissionMode !== undefined) out.permissionMode = options.permissionMode
  if (options.maxTurns !== undefined) out.maxTurns = options.maxTurns
  if (options.maxBudgetUsd !== undefined) out.maxBudgetUsd = options.maxBudgetUsd
  if (options.thinking !== undefined) out.thinking = options.thinking
  if (options.includePartialMessages !== undefined) out.includePartialMessages = options.includePartialMessages
  if (options.settingSources !== undefined) out.settingSources = options.settingSources
  if (options.sessionId !== undefined) out.sessionId = options.sessionId
  if (options.continue !== undefined) out.continue = options.continue
  if (options.resume !== undefined) out.resume = options.resume
  if (options.forkSession !== undefined) out.forkSession = options.forkSession
  if (options.persistSession !== undefined) out.persistSession = options.persistSession
  if (options.enableFileCheckpointing !== undefined) out.enableFileCheckpointing = options.enableFileCheckpointing
  if (options.sandbox !== undefined) out.sandbox = options.sandbox
  if (options.debug !== undefined) out.debug = options.debug
  if (options.debugFile !== undefined) out.debugFile = options.debugFile
  if (options.betas !== undefined) out.betas = [...options.betas]
  if (options.plugins !== undefined) out.plugins = options.plugins as unknown as AgentOptions['plugins']
  if (options.toolConfig !== undefined) out.toolConfig = options.toolConfig as unknown as AgentOptions['toolConfig']
  if (options.additionalDirectories !== undefined) out.additionalDirectories = options.additionalDirectories
  if (options.model !== undefined) out.model = options.model
  if (options.canUseTool !== undefined) {
    // Phase 3: internal CanUseToolFn is now an alias for the official
    // CanUseTool signature, so we forward the callback directly.
    out.canUseTool = options.canUseTool
  }

  // systemPrompt: official supports string | string[] | preset object.
  // Internal currently supports string | { type:'preset', preset:'default', append? }.
  if (typeof options.systemPrompt === 'string') {
    out.systemPrompt = options.systemPrompt
  } else if (Array.isArray(options.systemPrompt)) {
    out.systemPrompt = options.systemPrompt.join('\n')
  } else if (options.systemPrompt && typeof options.systemPrompt === 'object') {
    // 'claude_code' preset → internal 'default' preset
    out.systemPrompt = {
      type: 'preset',
      preset: 'default',
      append: options.systemPrompt.append,
    } as AgentOptions['systemPrompt']
  }

  // tools: official is `string[] | { type:'preset', preset:'claude_code' }`.
  // Internal accepts ToolDefinition[] | string[] | { type:'preset', preset:'default' }.
  if (Array.isArray(options.tools)) {
    out.tools = options.tools as string[]
  } else if (options.tools && typeof options.tools === 'object') {
    out.tools = { type: 'preset', preset: 'default' } as AgentOptions['tools']
  }

  // mcpServers: shapes are compatible (stdio/sse/http).
  // Note: official sdk variant carries a real McpServer instance under .instance.
  // Phase 4 will rewire the internal MCP path to consume that instance via
  // an in-process transport. For Phase 2 we pass through; the existing
  // sdk-mcp-server check in agent.ts handles legacy shape only.
  if (options.mcpServers !== undefined) {
    out.mcpServers = options.mcpServers as unknown as AgentOptions['mcpServers']
  }

  // agents: AgentDefinition shape now matches official 1:1 at the type layer.
  if (options.agents !== undefined) {
    out.agents = options.agents as unknown as AgentOptions['agents']
  }

  // hooks: official HookCallback has signature (input, toolUseID, {signal}).
  // Internal expects the same shape today (already adapted in agent.ts).
  if (options.hooks !== undefined) {
    out.hooks = options.hooks as unknown as AgentOptions['hooks']
  }

  // Non-official extension: OpenAI-compatible provider.
  if (ext.apiType !== undefined) out.apiType = ext.apiType
  if (ext.baseURL !== undefined) out.baseURL = ext.baseURL
  if (ext.apiKey !== undefined) out.apiKey = ext.apiKey

  return out
}
