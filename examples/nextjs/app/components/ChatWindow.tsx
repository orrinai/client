'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';
import type { LLMCompletionChunk, Message } from '@orrin-ai/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

interface ChatWindowProps {
  sessionId: string;
}

export default function ChatWindow({ sessionId }: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId) return;

    const userMessage = input.trim();
    setInput('');
    
    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    
    // Prepare a placeholder for assistant response
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
    
    setIsLoading(true);
    setError(null);
    
    // Create an AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    try {
      // Make a fetch request to the API endpoint
      const response = await fetch('/api/mcpClient/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, message: userMessage }),
        signal
      });
      
      if (!response.ok) {
        throw new Error('API request failed');
      }
      
      if (!response.body) {
        throw new Error('Response body is null');
      }
      
      const reader = response.body.getReader();
      let assistantMessage = '';
      let toolLogs: string[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // Convert the chunk to a string
        const chunk = new TextDecoder().decode(value);
        
        // Parse the chunk (which should be a JSON object)
        try {
          const events = chunk
            .split('\n\n')
            .filter(line => line.trim().startsWith('data: '))
            .map(line => JSON.parse(line.replace('data: ', '')));
          
          for (const event of events) {
            if (event.type === 'text_start') {
              setThinking(false);
            } else if (event.type === 'text_delta') {
              assistantMessage += event.delta;
              // Update the streaming message
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  lastMsg.content = assistantMessage;
                }
                return newMessages;
              });
            } else if (event.type === 'thinking_start') {
              setThinking(true);
            } else if (event.type === 'tool_use_start') {
              toolLogs.push(`Calling tool: "${event.name}"...`);
              // Update messages to show tool usage
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  lastMsg.content = assistantMessage + 
                    (assistantMessage ? '\n\n' : '') + 
                    toolLogs.join('\n');
                }
                return newMessages;
              });
            } else if (event.type === 'tool_result') {
              if (event.is_error) {
                toolLogs.push(`Tool call failed`);
              } else {
                toolLogs.push(`Tool call completed`);
              }
              
              // Update messages to show tool result
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMsg = newMessages[newMessages.length - 1];
                if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                  lastMsg.content = assistantMessage + 
                    (assistantMessage ? '\n\n' : '') + 
                    toolLogs.join('\n');
                }
                return newMessages;
              });
            } else if (event.type === 'error') {
              setError('An error occurred while generating the response');
            }
          }
        } catch (err) {
          console.error('Error parsing chunk:', err);
        }
      }
      
      // Complete the streaming once done
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          lastMsg.isStreaming = false;
        }
        return newMessages;
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Request was aborted');
      } else {
        console.error('Error sending message:', err);
        setError('Failed to send message. Please try again.');
        
        // Remove the incomplete assistant message
        setMessages(prev => prev.filter(msg => !msg.isStreaming));
      }
    } finally {
      setIsLoading(false);
      setThinking(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <div className="flex flex-col h-[80vh] max-w-3xl mx-auto border border-gray-200 rounded-lg">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold">Orrin AI Chat</h2>
        {sessionId && <p className="text-xs text-gray-500">Session ID: {sessionId}</p>}
      </div>
      
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <p>Send a message to start chatting with Orrin AI</p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`max-w-[80%] p-3 rounded-lg ${
                    msg.role === 'user' 
                      ? 'bg-blue-500 text-white rounded-br-none' 
                      : 'bg-gray-200 text-gray-800 rounded-bl-none'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.isStreaming && (
                    <div className="h-5 flex items-center">
                      {thinking ? (
                        <div className="text-xs italic">Thinking...</div>
                      ) : (
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
      
      {error && (
        <div className="p-2 bg-red-100 text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder={
              isLoading ? "Please wait..." : "Type your message..."
            }
            className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
} 