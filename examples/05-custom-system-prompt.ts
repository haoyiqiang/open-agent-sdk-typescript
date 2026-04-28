/**
 * Example 5: Custom System Prompt — official query() API
 *
 * Shows how to customize the agent's behavior with a system prompt. The
 * official `Options.systemPrompt` accepts:
 *   - a plain string (replace the default entirely)
 *   - a string[] (concatenated)
 *   - `{ type: 'preset', preset: 'claude_code', append: '...' }` (extend the default)
 *
 * Run: npx tsx examples/05-custom-system-prompt.ts
 */
import { query } from '../src/index.js'

async function main() {
  console.log('--- Example 5: Custom System Prompt ---\n')

  for await (const event of query({
    prompt: 'Read src/agent.ts and give a brief code review.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 5,
      systemPrompt:
        'You are a senior code reviewer. When asked to review code, focus on: ' +
        '1) Security issues, 2) Performance concerns, 3) Maintainability. ' +
        'Be concise and use bullet points.',
    },
  })) {
    const msg = event as any
    if (msg.type === 'result') {
      console.log(msg.result)
    }
  }
}

main().catch(console.error)
