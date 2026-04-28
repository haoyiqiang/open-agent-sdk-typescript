/**
 * Example 14: OpenAI-Compatible Models — non-official extension
 *
 * The official `Options` type covers Anthropic only. This SDK extends it
 * with three optional fields (`apiType` / `apiKey` / `baseURL`) that route
 * the agent loop through an OpenAI-compatible endpoint such as OpenAI,
 * DeepSeek, Qwen, vLLM, or Ollama. Anthropic remains the default.
 *
 * The fields are accepted at the type layer via `Options & { ... }` so
 * code targeting only the official surface continues to compile.
 *
 * Environment variables:
 *   CODEANY_API_KEY=sk-...
 *   CODEANY_BASE_URL=https://api.openai.com/v1
 *   CODEANY_API_TYPE=openai-completions   # auto-detected from model name otherwise
 *
 * Run: npx tsx examples/14-openai-compat.ts
 */
import { query, type Options } from '../src/index.js'

type OpenAIOptions = Options & {
  apiType?: 'anthropic-messages' | 'openai-completions'
  apiKey?: string
  baseURL?: string
}

async function main() {
  console.log('--- Example 14: OpenAI-Compatible Models ---\n')

  const opts: OpenAIOptions = {
    apiType: 'openai-completions',
    model: process.env.CODEANY_MODEL || 'gpt-4o',
    apiKey: process.env.CODEANY_API_KEY,
    baseURL: process.env.CODEANY_BASE_URL || 'https://api.openai.com/v1',
    maxTurns: 5,
  }

  console.log(`Provider:  ${opts.apiType}`)
  console.log(`Model:     ${opts.model}`)
  console.log(`Base URL:  ${opts.baseURL}\n`)

  for await (const event of query({
    prompt: 'What is 2+2? Reply in one sentence.',
    options: opts,
  })) {
    const msg = event as any
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'text' && block.text?.trim()) {
          console.log(`Assistant: ${block.text}`)
        }
        if (block.type === 'tool_use') {
          console.log(`[${block.name}] ${JSON.stringify(block.input)}`)
        }
      }
    }
    if (msg.type === 'result') {
      console.log(`\n--- ${msg.subtype} (${msg.usage?.input_tokens}+${msg.usage?.output_tokens} tokens) ---`)
    }
  }
}

main().catch(console.error)
