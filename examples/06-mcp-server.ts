/**
 * Example 6: External MCP Server Integration — official query() API
 *
 * Connects to an stdio MCP server and uses its tools through the agent.
 * This example uses the official `@modelcontextprotocol/server-filesystem`.
 *
 * Prerequisites:
 *   npm install -g @modelcontextprotocol/server-filesystem
 *
 * Run: npx tsx examples/06-mcp-server.ts
 */
import { query } from '../src/index.js'

async function main() {
  console.log('--- Example 6: External MCP Server ---\n')
  console.log('Connecting to MCP filesystem server...\n')

  for await (const event of query({
    prompt: 'Use the filesystem MCP tools to list files in /tmp. Be brief.',
    options: {
      model: process.env.CODEANY_MODEL || 'claude-sonnet-4-6',
      maxTurns: 10,
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
    },
  })) {
    const msg = event as any
    if (msg.type === 'result') {
      console.log(`Answer: ${msg.result}`)
      console.log(`Turns: ${msg.num_turns}`)
    }
  }
}

main().catch((e: Error) => {
  console.error('Error:', e.message)
  if (e.message.includes('ENOENT') || e.message.includes('not found')) {
    console.error(
      '\nMCP server not found. Install it with:\n' +
        '  npm install -g @modelcontextprotocol/server-filesystem\n',
    )
  }
})
