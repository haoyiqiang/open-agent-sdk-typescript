/**
 * Example 15: Drop-in compatibility with @anthropic-ai/claude-agent-sdk
 *
 * Demonstrates that code written against the official SDK works without
 * modification when imported from `@codeany/open-agent-sdk` instead.
 *
 * The full official surface is exercised here:
 *   - `query({prompt, options}): Query`
 *   - `Query` control methods: interrupt, setModel, setPermissionMode,
 *     close, accountInfo, supportedModels, mcpServerStatus, getContextUsage
 *   - `tool()` + `createSdkMcpServer()` returning `McpSdkServerConfigWithInstance`
 *   - Session API: listSessions, foldSessionSummary, InMemorySessionStore
 *   - Constants: HOOK_EVENTS, EXIT_REASONS, SYSTEM_PROMPT_DYNAMIC_BOUNDARY
 *
 * Note: this script does NOT call the LLM — it verifies the surface only.
 * For an end-to-end query, set CODEANY_API_KEY and uncomment the marked block.
 *
 * Run: npx tsx examples/15-official-compat.ts
 */
import {
  query,
  tool,
  createSdkMcpServer,
  isSdkServerConfig,
  listSessions,
  foldSessionSummary,
  InMemorySessionStore,
  HOOK_EVENTS,
  EXIT_REASONS,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  AbortError,
  type Options,
  type Query,
  type SDKMessage,
  type CanUseTool,
  type HookCallback,
  type AgentDefinition,
} from '../src/index.js'
import { z } from 'zod'

async function main() {
  console.log('=== @codeany/open-agent-sdk — official-API compatibility demo ===\n')

  // Constants ---------------------------------------------------------------
  console.log('HOOK_EVENTS (' + HOOK_EVENTS.length + '):', HOOK_EVENTS.slice(0, 4).join(', '), '...')
  console.log('EXIT_REASONS:', [...EXIT_REASONS].join(', '))
  console.log('SYSTEM_PROMPT_DYNAMIC_BOUNDARY:', SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  console.log('AbortError instanceof Error:', new AbortError() instanceof Error, '\n')

  // tool() + createSdkMcpServer --------------------------------------------
  const weather = tool(
    'get_weather',
    'Get weather for a city',
    { city: z.string().describe('City name') },
    async ({ city }) => ({ content: [{ type: 'text', text: `22C in ${city}` }] }),
  )
  console.log('tool().inputSchema is raw shape:', !('parse' in (weather.inputSchema as any)))

  const server = createSdkMcpServer({
    name: 'weather',
    version: '0.1.0',
    tools: [weather],
  })
  console.log('createSdkMcpServer returns shape:', { type: server.type, name: server.name, hasInstance: 'instance' in server })
  console.log('isSdkServerConfig(server):', isSdkServerConfig(server), '\n')

  // Session API ------------------------------------------------------------
  const store = new InMemorySessionStore()
  await store.append({ projectKey: 'demo', sessionId: 'sess-1' }, [
    { type: 'user', uuid: 'u1', timestamp: '2024-01-01T00:00:00Z', message: { role: 'user', content: 'hello' } },
  ])
  const summary = foldSessionSummary(undefined, { projectKey: 'demo', sessionId: 'sess-1' }, [
    { type: 'session_title', title: 'Demo Session' },
  ])
  console.log('foldSessionSummary →', summary)

  const sessions = await listSessions({ dir: '/this/path/does/not/exist' })
  console.log('listSessions on missing dir →', sessions.length, 'entries\n')

  // canUseTool / hooks shape (type-only check) -----------------------------
  const canUseTool: CanUseTool = async (toolName, _input, _ctx) => {
    if (toolName.startsWith('mcp__')) return { behavior: 'allow' }
    return { behavior: 'deny', message: 'Only MCP tools allowed' }
  }
  const preToolUse: HookCallback = async (_input, _id, _opts) => ({})

  const agentDef: AgentDefinition = {
    description: 'A research assistant',
    prompt: 'You are a research assistant.',
    tools: ['Read', 'Grep'],
  }

  // query() — surface only, no LLM call --------------------------------------
  const opts: Options = {
    model: 'claude-sonnet-4-6',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Be concise.' },
    tools: { type: 'preset', preset: 'claude_code' },
    mcpServers: { weather: server },
    agents: { researcher: agentDef },
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
  }
  const q: Query = query({ prompt: 'no-op surface check', options: opts })

  // Confirm Query control surface
  console.log('Query has', [
    'interrupt', 'setPermissionMode', 'setModel', 'setMaxThinkingTokens',
    'applyFlagSettings', 'initializationResult', 'supportedCommands',
    'supportedModels', 'supportedAgents', 'mcpServerStatus', 'getContextUsage',
    'accountInfo', 'readFile', 'rewindFiles', 'seedReadState',
    'reconnectMcpServer', 'toggleMcpServer', 'setMcpServers', 'reloadPlugins',
    'streamInput', 'stopTask', 'close',
  ].filter((m) => typeof (q as any)[m] === 'function').length, 'control methods')

  // Stub-call a few control methods to prove they execute
  const init = await q.initializationResult()
  console.log('initializationResult:', init && typeof init === 'object' ? 'ok' : 'missing')
  const acc = await q.accountInfo()
  console.log('accountInfo:', acc)

  q.close()
  console.log('\nq.close() completed — surface check OK.')

  // Sanity: the Query is also a proper AsyncGenerator
  console.log('Query is async iterable:', typeof q[Symbol.asyncIterator] === 'function')

  // Type-level smoke: SDKMessage union still resolves at compile time.
  const _msg: SDKMessage | undefined = undefined
  void _msg

  /*
  // === Live LLM call (uncomment + provide CODEANY_API_KEY) ===============
  for await (const event of query({
    prompt: 'Say hi in 3 words.',
    options: { model: 'claude-sonnet-4-6' },
  })) {
    if ((event as any).type === 'assistant') {
      console.log('Assistant:', (event as any).message)
    }
  }
  */
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
