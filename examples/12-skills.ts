/**
 * Example 12: Skills — official `Options.skills` field
 *
 * The official `Options.skills` accepts `string[] | 'all'`. Pass `'all'` to
 * make every bundled skill available to the agent; pass an explicit list to
 * select a subset.
 *
 * Run: npx tsx examples/12-skills.ts
 */
import { query } from '../src/index.js'

async function main() {
  console.log('--- Example 12: Skills ---\n')

  for await (const event of query({
    prompt: 'Use the available skills to explain what git rebase does.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 5,
      skills: 'all',
    },
  })) {
    const msg = event as any
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          console.log(`[${block.name}] ${JSON.stringify(block.input).slice(0, 100)}`)
        }
        if (block.type === 'text' && block.text?.trim()) {
          console.log(block.text)
        }
      }
    }
    if (msg.type === 'result') {
      console.log(`\n--- ${msg.subtype} ---`)
    }
  }
}

main().catch(console.error)
