# Orrin AI Next.js Example

A complete Next.js web application demonstrating the Orrin AI framework with streaming responses.

## Prerequisites

- Node.js 18+ installed
- An Anthropic API key (Claude access)

## Setup

1. Clone the repository (if you haven't already)

2. Install dependencies:
```bash
cd examples/nextjs
npm install
```

3. Create a `.env.local` file in the `examples/nextjs` directory with the following content:
```
ANTHROPIC_API_KEY=your_api_key_here
```

## Running the Example

Start the development server:
```bash
npm run dev
```

This will launch the Next.js application on [http://localhost:3000](http://localhost:3000).

## Features Demonstrated

This example showcases:

1. **API Routes Integration**: How to set up Next.js API routes with Orrin AI
2. **Server-Sent Events**: Real-time streaming of AI responses
3. **Session Management**: Creating and managing conversation sessions
4. **UI Components**: A complete chat interface with message history
5. **Thinking State Display**: Visual indicator when the AI is thinking
6. **Tool Usage**: Demonstration of AI using tools when needed

## Application Structure

- `/app`: Next.js application (App Router)
  - `/api/mcpClient`: API route handlers for Orrin AI
  - `/components`: UI components for the chat interface
  - `/lib`: Utility functions and client-side helpers

## Key Files

- `/app/api/mcpClient/message/route.ts`: Main API endpoint for handling messages
- `/app/api/mcpClient/session/route.ts`: API endpoint for creating sessions
- `/app/page.tsx`: Main chat interface

## Implementation Details

The example demonstrates:

1. **Server Setup**:
```typescript
// app/api/mcpClient/message/route.ts
import { NextOrrinAi, NextOrrinAiOptions } from "@orrin-ai/nextjs";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";

const options = NextOrrinAiOptions({
  llmAdapter: new ClaudeAdapter(),
  databaseAdapter: new SQLiteDatabaseAdapter(),
});

const handler = NextOrrinAi(options);
export { handler as POST };
```

2. **Client-Side Integration**:
```typescript
// Setting up SSE connection
const eventSource = new EventSource(`/api/mcpClient/message?sessionId=${sessionId}`);

// Handling different event types
eventSource.addEventListener('text_delta', handleTextDelta);
eventSource.addEventListener('thinking_delta', handleThinking);
eventSource.addEventListener('tool_result', handleToolResult);
```

For a full understanding of the implementation, explore the source code in this directory.
