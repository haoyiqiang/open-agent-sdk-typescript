/**
 * Example 1: Simple Query with Streaming — official SDK API
 *
 * Uses the same `query()` shape as `@anthropic-ai/claude-agent-sdk`.
 *
 * Run: npx tsx examples/01-simple-query.ts
 */
import { query } from '../src/index.js'

async function main() {
  console.log('--- Example 1: Simple Query (official API) ---\n')

  for await (const event of query({
    prompt: 'Read package.json and tell me the project name and version in one sentence.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 10,
    },
  })) {
    const msg = event as any

    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          console.log(`[Tool] ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`)
        }
        if (block.type === 'text') {
          console.log(`\nAssistant: ${block.text}`)
        }
      }
    }

    if (msg.type === 'result') {
      console.log(`\n--- Result: ${msg.subtype} ---`)
      console.log(`Tokens: ${msg.usage?.input_tokens} in / ${msg.usage?.output_tokens} out`)
    }
  }
}

main().catch(console.error)
