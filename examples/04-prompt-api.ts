/**
 * Example 4: Aggregated Result — collect a final SDKResultMessage
 *
 * `query()` is a streaming AsyncGenerator. To get the same UX as a blocking
 * "ask once, get one answer" call, iterate until the final SDKResultMessage
 * and read its `result` / `usage` / `num_turns` / `duration_ms` fields.
 *
 * Run: npx tsx examples/04-prompt-api.ts
 */
import { query } from '../src/index.js'

async function main() {
  console.log('--- Example 4: Aggregated Result ---\n')

  for await (const event of query({
    prompt: 'Use Bash to run `node --version` and `npm --version`, then tell me the versions.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 5,
    },
  })) {
    const msg = event as any
    if (msg.type === 'result') {
      console.log(`Answer: ${msg.result}`)
      console.log(`Turns: ${msg.num_turns}`)
      console.log(`Tokens: ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out`)
      console.log(`Duration: ${msg.duration_ms}ms`)
    }
  }
}

main().catch(console.error)
