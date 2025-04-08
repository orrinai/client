# @orrin-ai/mcp-agent

Core package for Orrin AI - a fully resumable modular agent framework with MCP support.

## Installation

```bash
npm install @orrin-ai/mcp-agent
```

## Usage

The mcp-agent package provides the essential components for creating and managing AI agents with persistent sessions.

```typescript
import { OrrinAiClient } from "@orrin-ai/mcp-agent";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";

// Initialize the client with adapters
const client = new OrrinAiClient({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: new SQLiteDatabaseAdapter(),
  mcpServerUrls: ["http://localhost:3000/sse"] // Optional MCP servers
});

// Create and open a session
const sessionId = await client.createAndOpenSession();

// Process a user message with streaming responses
for await (const chunk of client.addUserMessage(sessionId, "Hello!")) {
  if ('type' in chunk && chunk.type === 'text_delta') {
    console.log(chunk.delta); // Process text chunks
  }
}

// Close the session when done
await client.closeSession(sessionId);

// Disconnect all agents if needed
await client.disconnectAll();
```

## API Reference

### OrrinAiClient

The main class for managing AI agent sessions.

#### Constructor

```typescript
constructor(config: OrrinAiClientConfig)
```

- `config.llmAdapter`: LLM adapter for communicating with AI models
- `config.databaseAdapter`: Database adapter for storing sessions and messages
- `config.mcpServerUrls`: Optional array of MCP server URLs for enhanced capabilities

#### Methods

- `createSession()`: Creates a new session in the database
- `openSession(sessionId)`: Opens an existing session by initializing an Agent
- `createAndOpenSession()`: Creates and opens a session in one operation
- `closeSession(sessionId)`: Closes a specific session
- `disconnectAll()`: Closes all active session agents
- `addUserMessage(sessionId, message)`: Adds a user message to a session and yields streamed responses

## License

MIT 