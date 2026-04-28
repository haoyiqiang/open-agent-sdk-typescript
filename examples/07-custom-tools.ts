/**
 * Example 7: Custom Tools — official `tool()` + `createSdkMcpServer()`
 *
 * Defines two custom tools (weather, calculator) using `tool()` with Zod
 * schemas, registers them on an in-process MCP server via
 * `createSdkMcpServer()`, then makes them available to `query()` through
 * `Options.mcpServers`. This is the official pattern for SDK-defined tools.
 *
 * Run: npx tsx examples/07-custom-tools.ts
 */
import { query, tool, createSdkMcpServer } from '../src/index.js'
import { z } from 'zod'

const weather = tool(
  'get_weather',
  'Get current weather for a city. Returns temperature and conditions.',
  { city: z.string().describe('City name (e.g., "Tokyo", "London")') },
  async ({ city }) => {
    const temps: Record<string, number> = {
      tokyo: 22,
      london: 14,
      beijing: 25,
      'new york': 18,
      paris: 16,
    }
    const temp = temps[city.toLowerCase()] ?? 20
    return { content: [{ type: 'text', text: `Weather in ${city}: ${temp}°C, partly cloudy` }] }
  },
)

const calculator = tool(
  'calc',
  'Evaluate a mathematical expression. Use ** for exponentiation.',
  { expression: z.string().describe('Math expression (e.g., "42 * 17 + 3", "2 ** 10")') },
  async ({ expression }) => {
    try {
      const result = Function(`'use strict'; return (${expression})`)()
      return { content: [{ type: 'text', text: `${expression} = ${result}` }] }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
    }
  },
)

async function main() {
  console.log('--- Example 7: Custom Tools ---\n')

  const utils = createSdkMcpServer({
    name: 'utils',
    version: '1.0.0',
    tools: [weather, calculator],
  })

  for await (const event of query({
    prompt: 'What is the weather in Tokyo and London? Also calculate 2**10 * 3. Be brief.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 10,
      mcpServers: { utils },
    },
  })) {
    const msg = event as any
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          console.log(`[${block.name}] ${JSON.stringify(block.input)}`)
        }
        if (block.type === 'text' && block.text?.trim()) {
          console.log(`\n${block.text}`)
        }
      }
    }
    if (msg.type === 'result') {
      console.log(`\n--- ${msg.subtype} ---`)
    }
  }
}

main().catch(console.error)
