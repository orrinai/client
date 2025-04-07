'use client';

import { useEffect, useState, useRef, FormEvent } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  toolLogs?: string[];
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
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: '', 
      isStreaming: true,
      isThinking: false,
      toolLogs: []
    }]);
    
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
      
      // Use a ReadableStream directly for SSE processing
      const reader = response.body.getReader();
      let buffer = '';
      let assistantMessage = '';
      let toolLogs: string[] = [];
      const toolIdToNameMap: Map<string, string> = new Map();
      // Track tool_use_delta events to build tool call contents
      const toolCallContents: Map<string, string> = new Map();
      
      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // Decode the chunk and add to buffer
        buffer += new TextDecoder().decode(value);
        
        // Process complete events in buffer
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep the last incomplete event in buffer
        
        for (const event of events) {
          if (!event.trim()) continue; // Skip empty events
          
          const eventLines = event.split('\n');
          const eventTypeLine = eventLines.find(line => line.startsWith('event:'));
          const eventDataLine = eventLines.find(line => line.startsWith('data:'));
          
          if (!eventTypeLine || !eventDataLine) continue;
          
          const eventType = eventTypeLine.replace('event:', '').trim();
          const eventData = eventDataLine.replace('data:', '').trim();
          
          try {
            const data = eventData ? JSON.parse(eventData) : {};
            
            switch (eventType) {
              case 'stream_start':
                console.log('Stream started');
                break;
                
              case 'thinking_start':
                setThinking(true);
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    lastMsg.isThinking = true;
                  }
                  return newMessages;
                });
                break;
                
              case 'thinking_delta':
                // Just update thinking state - no need to show thinking content
                break;
                
              case 'thinking_end':
                setThinking(false);
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    lastMsg.isThinking = false;
                  }
                  return newMessages;
                });
                break;
                
              case 'text_start':
                setThinking(false);
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    lastMsg.isThinking = false;
                  }
                  return newMessages;
                });
                break;
                
              case 'text_delta':
                if (data.delta) {
                  assistantMessage += data.delta;
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                      lastMsg.content = assistantMessage;
                      lastMsg.isThinking = false;
                    }
                    return newMessages;
                  });
                }
                break;
                
              case 'text_end':
                // Text has ended, update message to final state
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    lastMsg.isThinking = false;
                  }
                  return newMessages;
                });
                break;
                
              case 'tool_use_start':
                toolIdToNameMap.set(data.id, data.name);
                toolCallContents.set(data.id, ''); // Initialize empty content for this tool call
                const toolLog = `Calling tool: "${data.name}"...`;
                toolLogs.push(toolLog);
                
                setMessages(prev => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                    lastMsg.toolLogs = [...toolLogs];
                    lastMsg.isThinking = false;
                  }
                  return newMessages;
                });
                break;
                
              case 'tool_use_delta':
                // Accumulate the tool call content
                if (data.id && data.delta !== undefined) {
                  const currentContent = toolCallContents.get(data.id) || '';
                  toolCallContents.set(data.id, currentContent + data.delta);
                }
                break;
                
              case 'tool_use_end':
                // Tool call is finished, update UI
                if (data.id) {
                  const toolName = toolIdToNameMap.get(data.id) || data.id;
                  const toolContent = toolCallContents.get(data.id) || '';
                  console.log(`Tool call "${toolName}" completed with params:`, toolContent);
                }
                break;
                
              case 'tool_result':
                if (data.tool_results && Array.isArray(data.tool_results)) {
                  for (const result of data.tool_results) {
                    const toolName = toolIdToNameMap.get(result.tool_call_id) || result.tool_call_id;
                    const status = result.is_error ? 'failed' : 'completed';
                    const resultLog = `Tool call "${toolName}" ${status}`;
                    toolLogs.push(resultLog);
                  }
                  
                  setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg.role === 'assistant') {
                      lastMsg.toolLogs = [...toolLogs];
                      lastMsg.isThinking = false;
                    }
                    return newMessages;
                  });
                }
                break;
                
              case 'stream_end':
                // Note: We don't complete the message here as there might be tool_result events coming
                console.log('Stream ended, but continuing to listen for tool results');
                break;
                
              case 'error':
                setError('An error occurred while generating the response');
                break;
            }
          } catch (err) {
            console.error('Error processing event:', eventType, eventData, err);
          }
        }
      }
      
      // Complete the streaming once reader is done
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          lastMsg.isStreaming = false;
          lastMsg.isThinking = false;
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
                  {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                  
                  {msg.toolLogs && msg.toolLogs.length > 0 && (
                    <div className="mt-2 text-xs border-t border-gray-300 pt-2">
                      {msg.toolLogs.map((log, logIdx) => (
                        <div key={logIdx} className="py-1">{log}</div>
                      ))}
                    </div>
                  )}
                  
                  {msg.isStreaming && (
                    <div className="h-5 flex items-center mt-1">
                      {msg.isThinking ? (
                        <div className="text-xs italic">Thinking...</div>
                      ) : msg.content === '' && (!msg.toolLogs || msg.toolLogs.length === 0) ? (
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      ) : null}
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