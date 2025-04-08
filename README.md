# Orrin AI

A fully resumable modular agent framework with comprehensive MCP (Main Control Program) support for building AI applications.

## Features

- **Resumable Sessions**: Maintain conversation state across application restarts
- **Modular Architecture**: Swap components based on your needs
- **MCP Support**: Connect to MCP servers for enhanced agent capabilities
- **Streaming Responses**: Real-time streaming with Server-Sent Events (SSE)

## Installation

```bash
# Install the core package
npm install @orrin-ai/mcp-agent

# Install adapters as needed
npm install @orrin-ai/llm-adapters-anthropic
npm install @orrin-ai/database-adapter-sqlite
```

## Quick Start with Next.js

Integrate Orrin AI into your Next.js application with minimal setup:

```typescript
// app/api/mcpClient/message/route.ts
import { NextOrrinAi, NextOrrinAiOptions } from "@orrin-ai/nextjs";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";

// Configure your OrrinAI client
const options = NextOrrinAiOptions({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: new SQLiteDatabaseAdapter(),
  mcpServerUrls: ["http://localhost:3000/sse"] // Optional MCP servers
});

// Create and export the API route handler
const handler = NextOrrinAi(options);
export { handler as POST };
```

## Examples

Check out the included examples to see Orrin AI in action:

- **CLI Example**: See `/examples/cli` for a command-line implementation
- **Next.js Example**: See `/examples/nextjs` for a full web application

## Database Adapters

Orrin AI supports multiple storage options through its adapter system:

- **SQLiteDatabaseAdapter**: Persistent storage using SQLite
- **InMemoryDatabaseAdapter**: In-memory storage for testing or simple applications
- **And More To Come**

```typescript
// Using SQLite adapter
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";
const dbAdapter = new SQLiteDatabaseAdapter();

// Using in-memory adapter
import { InMemoryDatabaseAdapter } from "@orrin-ai/database-adapter-in-memory";
const dbAdapter = new InMemoryDatabaseAdapter();
```

## LLM Adapters

Connect to different language models with our adapter system:

- **ClaudeAdapter**: Integration with Anthropic's Claude models
- **And More To Come**

```typescript
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";

// Initialize with your API key (or use environment variable ANTHROPIC_API_KEY)
const llmAdapter = new ClaudeAdapter();
```

## Advanced Usage

Create a standalone agent with full control:

```typescript
import { OrrinAiClient } from "@orrin-ai/mcp-agent";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";

const client = new OrrinAiClient({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: new SQLiteDatabaseAdapter(),
  mcpServerUrls: ["http://localhost:3000/sse"]
});

// Create and manage sessions
const sessionId = await client.createAndOpenSession();

// Process user messages with streaming responses
for await (const chunk of client.addUserMessage(sessionId, "Hello!")) {
  if ('type' in chunk && chunk.type === 'text_delta') {
    process.stdout.write(chunk.delta);
  }
}

// Close session when done
await client.closeSession(sessionId);
```

## License

MIT 