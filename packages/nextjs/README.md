# @orrin-ai/nextjs

Next.js integration for Orrin AI, providing Server-Sent Events (SSE) support for streaming AI responses.

## Installation

```bash
npm install @orrin-ai/nextjs
```

## Usage

The nextjs package makes it easy to integrate Orrin AI into your Next.js application with API routes.

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

### Client-Side Implementation

In your frontend React components:

```tsx
import { useState, useEffect } from 'react';

function ChatComponent() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  
  // Create a session when component mounts
  useEffect(() => {
    async function createSession() {
      const response = await fetch('/api/mcpClient/session', {
        method: 'POST'
      });
      const data = await response.json();
      setSessionId(data.sessionId);
    }
    createSession();
  }, []);
  
  const sendMessage = async () => {
    if (!sessionId || !input.trim()) return;
    
    // Add user message to UI
    setMessages(prev => [...prev, `User: ${input}`]);
    let assistantMessage = '';
    
    // Set up SSE connection
    const eventSource = new EventSource(`/api/mcpClient/message?sessionId=${sessionId}`);
    
    // Listen for text chunks
    eventSource.addEventListener('text_delta', (event) => {
      const data = JSON.parse(event.data);
      assistantMessage += data.delta;
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = `Assistant: ${assistantMessage}`;
        return newMessages;
      });
    });
    
    // Handle end of stream
    eventSource.addEventListener('stream_end', () => {
      eventSource.close();
    });
    
    // Send the message
    await fetch('/api/mcpClient/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        message: input
      })
    });
    
    setInput('');
  };
  
  return (
    <div>
      <div className="messages">
        {messages.map((msg, i) => <div key={i}>{msg}</div>)}
      </div>
      <input 
        value={input} 
        onChange={e => setInput(e.target.value)} 
        placeholder="Type a message..."
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}

export default ChatComponent;
```

## API Reference

### NextOrrinAiOptions

```typescript
function NextOrrinAiOptions(config: OrrinAiClientConfig)
```

Creates an options object for NextOrrinAi with session management methods:
- `createSession()`: Creates a new session
- `openSession(sessionId)`: Opens an existing session
- `createAndOpenSession()`: Creates and opens a session in one operation
- `closeSession(sessionId)`: Closes a session
- `disconnectAll()`: Closes all active sessions
- `addUserMessage(sessionId, message)`: Adds a user message and processes it

### NextOrrinAi

```typescript
function NextOrrinAi(options: ReturnType<typeof NextOrrinAiOptions>)
```

Creates a Next.js API route handler that processes requests and returns streamed responses using Server-Sent Events.

## License

MIT 