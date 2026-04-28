/**
 * Phase 1 + Phase 2 verification — type-only.
 *
 * Confirms that:
 *   1. All key official types are importable from `./official`.
 *   2. The new `query()` from `../query.ts` matches the official signature.
 *   3. Calling the new `query()` produces an object satisfying the `Query`
 *      interface (assignable to AsyncGenerator<SDKMessage> + control methods).
 *
 * This file has no runtime side effects.
 */
import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  PermissionMode,
  SettingSource,
  HookEvent,
  EffortLevel,
  CanUseTool,
  HookCallback,
  McpServerConfig,
  AgentDefinition,
} from './official.js'

import { query } from '../query.js'

// Smoke checks: literal compatibility.
const _permMode: PermissionMode = 'default'
const _setting: SettingSource = 'user'
const _hookEvent: HookEvent = 'PreToolUse'
const _effort: EffortLevel = 'medium'

// query() signature check — the new public entry point.
function _queryStringPrompt(): Query {
  const options: Options = { model: 'claude-sonnet-4-6' }
  return query({ prompt: 'hello', options })
}

async function* _userMessageStream(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000000',
    session_id: 's',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'hi' },
  } as unknown as SDKUserMessage
}

function _queryStreamingPrompt(): Query {
  return query({ prompt: _userMessageStream() })
}

async function _consumeQuery() {
  const q: Query = query({ prompt: 'hi' })

  // AsyncGenerator surface
  for await (const m of q) {
    const _: SDKMessage = m
    void _
    break
  }

  // Control methods — type-level only.
  await q.interrupt()
  await q.setPermissionMode('acceptEdits')
  await q.setModel('claude-opus-4-7')
  await q.setMaxThinkingTokens(8192)
  await q.applyFlagSettings({})
  await q.initializationResult()
  await q.supportedCommands()
  await q.supportedModels()
  await q.supportedAgents()
  await q.mcpServerStatus()
  await q.getContextUsage()
  await q.accountInfo()
  await q.readFile('foo.txt')
  await q.rewindFiles('uuid')
  await q.seedReadState('foo.txt', 0)
  await q.setMcpServers({})
  await q.streamInput(_userMessageStream())
  await q.stopTask('task-id')
  q.close()
}

// canUseTool / hooks / mcpServers field shapes
const _opts: Options = {
  model: 'claude-sonnet-4-6',
  systemPrompt: { type: 'preset', preset: 'claude_code', append: 'extra' },
  tools: { type: 'preset', preset: 'claude_code' },
  mcpServers: {} as Record<string, McpServerConfig>,
  agents: {} as Record<string, AgentDefinition>,
  permissionMode: 'default',
  canUseTool: (async (_name, _input, _ctx) => ({
    behavior: 'allow',
  })) satisfies CanUseTool,
  hooks: {
    PreToolUse: [
      {
        hooks: [
          (async (_input, _id, _o) => ({
            decision: undefined,
          })) satisfies HookCallback,
        ],
      },
    ],
  },
}

void _permMode
void _setting
void _hookEvent
void _effort
void _queryStringPrompt
void _queryStreamingPrompt
void _consumeQuery
void _opts
