/**
 * Public `query()` entry point — official `@anthropic-ai/claude-agent-sdk` API.
 *
 * Phase 2: surface-level alignment.
 *   - Signature: `function query({ prompt, options? }): Query` (verbatim)
 *   - `Query` interface: AsyncGenerator<SDKMessage, void> + 23 control methods
 *   - Internally delegates to the existing `Agent` runtime engine.
 *
 * Phase 3+ will tighten the internal implementation to match CLI behaviour
 * (permission three-tier, hook semantics, MCP in-process transport, real
 * 28-variant SDKMessage emit, etc.).
 */

import type {
  Query,
  Options,
  SDKMessage,
  SDKUserMessage,
  PermissionMode,
  Settings,
  SDKControlInitializeResponse,
  SDKControlGetContextUsageResponse,
  SDKControlReadFileResponse,
  SDKControlReloadPluginsResponse,
  SlashCommand,
  ModelInfo,
  AgentInfo,
  AccountInfo,
  McpServerStatus,
  McpServerConfig,
  McpSetServersResult,
  RewindFilesResult,
} from './types/index.js'
import { Agent } from './agent.js'
import type { AgentOptions } from './types.js'
import { adaptOptions } from './query-options-adapter.js'

/**
 * Execute an agentic query.
 *
 * @param params.prompt    - Either a single user prompt (string) or an
 *                           AsyncIterable of `SDKUserMessage` for
 *                           streaming-input mode.
 * @param params.options   - Configuration. Mirrors the official `Options`
 *                           type. Bridge/Worker / remote-control fields are
 *                           ignored — the SDK runs the agent loop in-process.
 * @returns A `Query` — both an AsyncGenerator yielding SDKMessage events
 *          and a control surface (interrupt, setModel, ...).
 */
export function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query {
  return new QueryImpl(params.prompt, params.options ?? {})
}

// --------------------------------------------------------------------------
// Internal: Query implementation
// --------------------------------------------------------------------------

class QueryImpl implements Query {
  private readonly agent: Agent
  private readonly options: Options
  private gen: AsyncGenerator<SDKMessage, void> | null = null
  private streamingInputDone: Promise<void> | null = null
  private closed = false

  constructor(prompt: string | AsyncIterable<SDKUserMessage>, options: Options) {
    this.options = options

    // Build internal Agent with adapted options (type-only translation;
    // runtime shape is unchanged for Phase 2).
    const adapted: AgentOptions = adaptOptions(options)
    this.agent = new Agent(adapted)

    if (typeof prompt === 'string') {
      this.gen = this.runSingleShot(prompt)
    } else {
      // Streaming-input mode: kick off a background pump that feeds
      // successive prompts into the agent.
      this.gen = this.runStreaming(prompt)
    }
  }

  // ----------------------------------------------------------------------
  // AsyncGenerator interface
  // ----------------------------------------------------------------------

  next(...args: [] | [unknown]): Promise<IteratorResult<SDKMessage, void>> {
    if (!this.gen) return Promise.resolve({ value: undefined, done: true })
    return this.gen.next(...(args as []))
  }

  return(value?: void | PromiseLike<void>): Promise<IteratorResult<SDKMessage, void>> {
    if (!this.gen) return Promise.resolve({ value: undefined, done: true })
    return this.gen.return(value as void)
  }

  throw(e?: unknown): Promise<IteratorResult<SDKMessage, void>> {
    if (!this.gen) return Promise.reject(e)
    return this.gen.throw(e)
  }

  [Symbol.asyncIterator](): this {
    return this
  }

  // Optional async dispose — TypeScript's AsyncGenerator type has it as
  // optional. Forward to close() so `await using q = query(...)` works.
  async [Symbol.asyncDispose](): Promise<void> {
    this.close()
  }

  // ----------------------------------------------------------------------
  // Control methods (official Query surface)
  // ----------------------------------------------------------------------

  async interrupt(): Promise<void> {
    await this.agent.interrupt()
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.agent.setPermissionMode(mode)
  }

  async setModel(model?: string): Promise<void> {
    await this.agent.setModel(model)
  }

  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    await this.agent.setMaxThinkingTokens(maxThinkingTokens)
  }

  async applyFlagSettings(settings: Settings): Promise<void> {
    // TODO Phase 3+: deep-merge into runtime settings layer.
    void settings
  }

  async initializationResult(): Promise<SDKControlInitializeResponse> {
    // Stub minimal response. Phase 2: shape only.
    // Phase 3+ will populate with real values from the engine.
    return {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: '',
        response: {
          commands: [],
          subtype: 'init',
          mcp_servers: [],
          tools: [],
          agents: [],
          model: this.options.model ?? 'claude-sonnet-4-6',
          permissionMode: this.options.permissionMode ?? 'default',
          slash_commands: [],
          output_style: 'default',
          available_output_styles: [],
        },
      },
    } as unknown as SDKControlInitializeResponse
  }

  async supportedCommands(): Promise<SlashCommand[]> {
    return []
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return []
  }

  async supportedAgents(): Promise<AgentInfo[]> {
    const agents = this.options.agents
    if (!agents) return []
    return Object.entries(agents).map(([name, def]) => ({
      name,
      description: def.description,
      model: def.model,
    }))
  }

  async mcpServerStatus(): Promise<McpServerStatus[]> {
    return []
  }

  async getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    return {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: '',
        response: {
          total_tokens: 0,
          context_window: 200_000,
          categories: {},
        },
      },
    } as unknown as SDKControlGetContextUsageResponse
  }

  async accountInfo(): Promise<AccountInfo> {
    // No real auth/account in this in-process SDK by default.
    return {}
  }

  async readFile(
    path: string,
    options?: { maxBytes?: number; encoding?: 'utf-8' | 'base64' },
  ): Promise<SDKControlReadFileResponse | null> {
    void path
    void options
    return null
  }

  async rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): Promise<RewindFilesResult> {
    void userMessageId
    void options
    return { canRewind: false, error: 'rewindFiles not implemented' }
  }

  async seedReadState(path: string, mtime: number): Promise<void> {
    void path
    void mtime
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    void serverName
    throw new Error('reconnectMcpServer: not implemented in Phase 2')
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    void serverName
    void enabled
    throw new Error('toggleMcpServer: not implemented in Phase 2')
  }

  async setMcpServers(
    servers: Record<string, McpServerConfig>,
  ): Promise<McpSetServersResult> {
    void servers
    return { added: [], removed: [], errors: {} }
  }

  async reloadPlugins(): Promise<SDKControlReloadPluginsResponse> {
    return {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: '',
        response: {
          commands: [],
          agents: [],
          plugins: [],
          mcp_servers: [],
        },
      },
    } as unknown as SDKControlReloadPluginsResponse
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    // Push subsequent user messages into the running generator. The current
    // engine runs one query per prompt, so we await each prompt sequentially.
    for await (const msg of stream) {
      const text = extractText(msg)
      if (!text) continue
      // Drain the existing generator first if any, then queue another turn.
      // Phase 2: simple sequential model. Phase 7 will switch to a real
      // multi-prompt streaming-input implementation.
      void this.agent.query(text)
    }
  }

  async stopTask(taskId: string): Promise<void> {
    await this.agent.stopTask(taskId)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // Best-effort: abort + cleanup. Errors swallowed (close is fire-and-forget).
    void this.agent.interrupt().catch(() => {})
    void this.agent.close().catch(() => {})
  }

  // ----------------------------------------------------------------------
  // Internal generators
  // ----------------------------------------------------------------------

  private async *runSingleShot(prompt: string): AsyncGenerator<SDKMessage, void> {
    try {
      // Phase 7: engine emits official-shape SDKMessage variants. The
      // internal stream is structurally compatible with the public union;
      // we still cast to satisfy TypeScript because internal typing in
      // src/types.ts is a slightly looser subset.
      for await (const ev of this.agent.query(prompt)) {
        yield ev as unknown as SDKMessage
      }
    } finally {
      void this.agent.close().catch(() => {})
    }
  }

  private async *runStreaming(
    stream: AsyncIterable<SDKUserMessage>,
  ): AsyncGenerator<SDKMessage, void> {
    try {
      for await (const msg of stream) {
        const text = extractText(msg)
        if (!text) continue
        for await (const ev of this.agent.query(text)) {
          yield ev as unknown as SDKMessage
        }
      }
    } finally {
      void this.agent.close().catch(() => {})
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function extractText(msg: SDKUserMessage): string {
  const content = msg.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => typeof b === 'object' && b !== null && 'type' in b && (b as { type: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('')
  }
  return ''
}
