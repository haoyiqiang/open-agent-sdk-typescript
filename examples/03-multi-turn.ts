/**
 * Example 3: Multi-Turn Conversation — official query() API with streaming input
 *
 * Demonstrates session persistence across multiple turns by feeding an
 * AsyncIterable<SDKUserMessage> stream into a single `query()`.
 *
 * Run: npx tsx examples/03-multi-turn.ts
 */
import { query, type SDKUserMessage } from '../src/index.js'
import * as crypto from 'node:crypto'

function userMsg(text: string, sessionId: string): SDKUserMessage {
  return {
    type: 'user',
    uuid: crypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    session_id: sessionId,
    parent_tool_use_id: null,
    message: { role: 'user', content: text },
  }
}

async function main() {
  console.log('--- Example 3: Multi-Turn Conversation ---\n')

  const sessionId = crypto.randomUUID()
  const turns = [
    'Use Bash to run: echo "Hello Open Agent SDK" > /tmp/oas-test.txt. Confirm briefly.',
    'Read the file you just created and tell me its contents.',
    'Delete that file with Bash. Confirm.',
  ]

  let i = 0
  async function* prompts(): AsyncGenerator<SDKUserMessage> {
    for (const t of turns) {
      console.log(`> Turn ${++i}: ${t.slice(0, 60)}…`)
      yield userMsg(t, sessionId)
    }
  }

  let lastText = ''
  for await (const event of query({
    prompt: prompts(),
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 5,
      sessionId,
    },
  })) {
    const msg = event as any
    if (msg.type === 'assistant') {
      const text = (msg.message?.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      if (text) lastText = text
    }
    if (msg.type === 'result') {
      console.log(`  ${lastText}\n`)
      lastText = ''
    }
  }
}

main().catch(console.error)
