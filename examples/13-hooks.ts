/**
 * Example 13: Lifecycle Hooks — official `Options.hooks`
 *
 * Demonstrates the official hook surface:
 *   `hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>`
 *
 * Each `HookCallback` has the signature
 *   `(input, toolUseID, { signal }) => Promise<HookJSONOutput>`.
 *
 * Run: npx tsx examples/13-hooks.ts
 */
import { query, type HookCallback } from '../src/index.js'

const onSessionStart: HookCallback = async (input, _toolUseID, _opts) => {
  const id = (input as { session_id?: string }).session_id ?? '?'
  console.log(`[Hook] Session started: ${id}`)
  return {}
}

const onPreToolUse: HookCallback = async (input, toolUseID, _opts) => {
  const i = input as { tool_name?: string }
  console.log(`[Hook] PreToolUse: ${i.tool_name} (${toolUseID})`)
  return {}
}

const onPostToolUse: HookCallback = async (input, _toolUseID, _opts) => {
  const i = input as { tool_name?: string }
  console.log(`[Hook] PostToolUse: ${i.tool_name}`)
  return {}
}

const onStop: HookCallback = async () => {
  console.log('[Hook] Stop')
  return {}
}

async function main() {
  console.log('--- Example 13: Lifecycle Hooks ---\n')

  for await (const event of query({
    prompt: 'What files are in the current directory? Be brief.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 5,
      hooks: {
        SessionStart: [{ hooks: [onSessionStart] }],
        PreToolUse: [{ hooks: [onPreToolUse] }],
        PostToolUse: [{ hooks: [onPostToolUse] }],
        Stop: [{ hooks: [onStop] }],
      },
    },
  })) {
    const msg = event as any
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          console.log(`\nAssistant: ${block.text.slice(0, 200)}`)
        }
      }
    }
    if (msg.type === 'result') {
      console.log(`\n--- ${msg.subtype} ---`)
    }
  }
}

main().catch(console.error)
