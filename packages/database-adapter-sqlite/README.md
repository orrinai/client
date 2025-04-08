# @orrin-ai/database-adapter-sqlite

SQLite database adapter for Orrin AI framework, providing persistent storage for AI sessions and messages.

## Installation

```bash
npm install @orrin-ai/database-adapter-sqlite
```

## Usage

The database-adapter-sqlite package provides SQLite-based persistence for Orrin AI conversations.

```typescript
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";
import { OrrinAiClient } from "@orrin-ai/mcp-agent";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";

// Initialize with default options
// This creates a SQLite database file in the default location
const dbAdapter = new SQLiteDatabaseAdapter();

// Or, configure with custom database path
const dbAdapterWithOptions = new SQLiteDatabaseAdapter({
  databasePath: "./my-custom-path/conversations.db"
});

// Use with OrrinAiClient
const client = new OrrinAiClient({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: dbAdapter
});
```

## API Reference

### SQLiteDatabaseAdapter

Database adapter for SQLite persistence.

#### Constructor

```typescript
constructor(config?: SQLiteDatabaseAdapterConfig)
```

Optional configuration:
- `config.databasePath`: Custom path for the SQLite database file (defaults to "./orrin-ai.db")

#### Key Methods (implements DatabaseAdapter interface)

- `createSession(sessionId)`: Creates a new session
- `getSession(sessionId)`: Retrieves session information
- `addMessage(sessionId, message)`: Stores a message for a session
- `getMessages(sessionId)`: Retrieves all messages for a session

## License

MIT 