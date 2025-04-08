# @orrin-ai/llm-adapters-anthropic

Anthropic Claude adapter for Orrin AI framework.

## Installation

```bash
npm install @orrin-ai/llm-adapters-anthropic
```

## Usage

The llm-adapters-anthropic package provides integration with Anthropic's Claude models.

```typescript
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { OrrinAiClient } from "@orrin-ai/mcp-agent";
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";

// Initialize the Claude adapter
// Uses ANTHROPIC_API_KEY from environment variables by default
const llmAdapter = new ClaudeAdapter();

// Or, configure with options
const llmAdapterWithOptions = new ClaudeAdapter({
  apiKey: "your-api-key", // Optional: override environment variable
  modelName: "claude-3-opus-20240229", // Optional: specify model version
  temperature: 0.7 // Optional: adjust temperature
});

// Use with OrrinAiClient
const client = new OrrinAiClient({
  llmAdapter: llmAdapter,
  databaseAdapter: new SQLiteDatabaseAdapter()
});
```

## API Reference

### ClaudeAdapter

Adapter for Anthropic's Claude models.

#### Constructor

```typescript
constructor(config?: ClaudeAdapterConfig)
```

Optional configuration:
- `config.apiKey`: Anthropic API key (defaults to ANTHROPIC_API_KEY environment variable)
- `config.modelName`: Claude model to use (defaults to "claude-3-sonnet-20240229")
- `config.temperature`: Temperature for generation (defaults to 0.7)
- `config.maxTokens`: Maximum tokens in response (defaults to 4096)

## License

MIT 