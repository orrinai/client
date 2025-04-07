# Orrin AI

AI session management with streaming SSE support for Next.js applications.

## Installation

```bash
npm install orrin-ai
```

## Quick Start

### Setting up with Next.js API Route

```typescript
// app/api/ai/route.ts
import { NextOrrinAi, NextOrrinAiOptions, InMemoryDatabaseAdapter } from 'orrin-ai';
import yourLLMAdapter from './your-llm-adapter';

// Configure the OrrinAI client
const options = NextOrrinAiOptions({
  llmAdapter: yourLLMAdapter,
  databaseAdapter: new InMemoryDatabaseAdapter()
});

// Create and export the API route handler
const handler = NextOrrinAi(options);
export { handler as POST };
```

### Creating a Session

```typescript
// In your application logic
const response = await fetch('/api/ai/session', {
  method: 'POST'
});
const { sessionId } = await response.json();
```

### Sending a Message

```typescript
// Set up SSE connection
const eventSource = new EventSource(`/api/ai?sessionId=${sessionId}`);

// Listen for streamed responses
eventSource.addEventListener('text_delta', (event) => {
  const data = JSON.parse(event.data);
  console.log('Received text:', data.delta);
});

// Send message
await fetch('/api/ai', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sessionId,
    message: 'Hello, how can you help me today?'
  })
});
```

## Features

- Session-based conversation management
- Streaming responses with Server-Sent Events (SSE)
- Tool calling support
- Support for thinking state
- Easy integration with Next.js API routes
- In-memory database adapter included
- Extensible for custom LLM adapters

## Documentation

For more detailed documentation, please refer to our [GitHub repository](link-to-your-repo).

## License

MIT 