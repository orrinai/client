# @orrin-ai/database-adapter-in-memory

In-memory database adapter for Orrin AI framework, ideal for testing or simpler applications.

## Installation

```bash
npm install @orrin-ai/database-adapter-in-memory
```

## Usage

The database-adapter-in-memory package provides in-memory storage for Orrin AI sessions and messages.

```typescript
import { InMemoryDatabaseAdapter } from "@orrin-ai/database-adapter-in-memory";
import { OrrinAiClient } from "@orrin-ai/mcp-agent";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";

// Initialize the in-memory adapter
const dbAdapter = new InMemoryDatabaseAdapter();

// Use with OrrinAiClient
const client = new OrrinAiClient({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: dbAdapter
});

// Now you can use the client with in-memory storage
// Note: All data will be lost when the application restarts
const sessionId = await client.createAndOpenSession();
for await (const chunk of client.addUserMessage(sessionId, "Hello!")) {
  // Process response chunks
}
```

## API Reference

### InMemoryDatabaseAdapter

Database adapter for in-memory storage.

#### Constructor

```typescript
constructor()
```

#### Key Methods (implements DatabaseAdapter interface)

- `createSession(sessionId)`: Creates a new session in memory
- `getSession(sessionId)`: Retrieves session information
- `addMessage(sessionId, message)`: Stores a message for a session
- `getMessages(sessionId)`: Retrieves all messages for a session

## When to Use

The in-memory adapter is best for:
- Development and testing environments
- Simple applications where persistence isn't required
- Scenarios where you want to avoid database setup

For production applications that need to maintain conversation history across restarts, consider using the SQLiteDatabaseAdapter instead.

## License

MIT 