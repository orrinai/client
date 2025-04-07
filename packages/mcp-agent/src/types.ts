
// Represents a tool call requested by the LLM
export interface LLMToolCallRequest {
    id: string; // ID provided by the LLM to identify this specific call
    name: string;
    input: Record<string, any>;
}

// Represents the result of executing a tool call
export interface LLMToolResult {
    tool_call_id: string; // The ID of the tool_call request
    content: string | Record<string, any>; // The actual result data (string or structured)
    is_error?: boolean; // Indicate if the tool execution resulted in an error
}


export interface ToolResultMessage {
  role: 'tool_result';
  tool_results: LLMToolResult[]; // For multi-tool 'tool_result' role
  content: null;
  createdAt?: Date;
}

// Define a standard Message interface
export interface BaseMessage {
  role: 'user' | 'assistant' | 'assistant_thinking' | 'tool_use';
  content: string | null;
  // Optional structured data fields
  tool_calls?: LLMToolCallRequest[]; // Primarily for 'tool_use' role
  // Optional metadata (can be derived from structured fields if needed)
  createdAt?: Date;
}

export type Message = BaseMessage | ToolResultMessage;

// --- LLM Interaction Structures ---

// Represents chunks yielded by the streaming LLM adapter
export type LLMCompletionChunk = 
    // Stream Lifecycle
    | { type: 'stream_start' } 
    | { type: 'stream_end' } 
    // Text Block Events
    | { type: 'text_start' } 
    | { type: 'text_delta'; delta: string } 
    | { type: 'text_end' } 
    // Thinking Block Events
    | { type: 'thinking_start' } 
    | { type: 'thinking_delta'; delta: string }
    | { type: 'thinking_end' } 
    // Tool Use Block Events
    | { type: 'tool_use_start'; id: string; name: string } 
    | { type: 'tool_use_delta'; id: string; delta: string } // Partial JSON input 
    | { type: 'tool_use_end'; id: string } 
    // Error Event
    | { type: 'error'; error: Error }; 

// LLMTool definition for adapter configuration/availability
export type LLMTool = {
    name: string;
    description: string;
    input_schema: Record<string, any>; // General JSON schema object
};

// --- Adapter Interfaces ---

export interface LLMAdapter {
  // Changed return type to AsyncGenerator yielding LLMCompletionChunk
  createCompletion(messages: Message[], tools?: LLMTool[]): AsyncGenerator<LLMCompletionChunk, void, undefined>;
}

export interface DatabaseAdapter {
  /**
   * Creates a new session in the database with the given ID.
   * Should initialize any necessary data structures for the session.
   * @param sessionId - The ID of the session to create
   * @throws Error if the session already exists or cannot be created
   */
  createSession(sessionId: string): Promise<void>;
  
  /**
   * Retrieves session data for the given ID, or null if not found.
   * Used to check if a session exists before opening it.
   * @param sessionId - The ID of the session to retrieve
   * @returns Session data object or null if not found
   */
  getSession(sessionId: string): Promise<{id: string} | null>;
  
  /**
   * Adds a message to an existing session.
   * @param sessionId - The ID of the session to add the message to
   * @param message - The message to add
   * @throws Error if the session does not exist or the message cannot be added
   */
  addMessage(sessionId: string, message: Message): Promise<void>;
  
  /**
   * Retrieves all messages for a session in chronological order.
   * @param sessionId - The ID of the session to retrieve messages for
   * @returns Array of messages for the session
   * @throws Error if the session does not exist
   */
  getMessages(sessionId: string): Promise<Message[]>;
}
