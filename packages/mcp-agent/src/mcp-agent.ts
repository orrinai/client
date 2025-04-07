import { randomUUID } from 'crypto'; // Import randomUUID for generating session IDs
// Import agent only (it manages the router)
import { Agent } from './agent/agent.js';
import { logger } from './utils/logger.js'; // Import the logger
// Import the accumulator
import { MessageAccumulator } from './utils/message-accumulator.js';
import { LLMAdapter, DatabaseAdapter, ToolResultMessage, LLMCompletionChunk, Message } from './types.js';



// Configuration interface for the client
export interface OrrinAiClientConfig {
  llmAdapter: LLMAdapter;
  databaseAdapter: DatabaseAdapter;
  mcpServerUrls?: string[]; // Use URLs for config, convert to Transports internally
}

/**
 * The main client class for Orrin AI, acting as a Session Manager.
 * It creates and manages long-lived Agent instances per session.
 */
export class OrrinAiClient {
  private llmAdapter: LLMAdapter;
  private databaseAdapter: DatabaseAdapter;
  private mcpServerUrls: string[]; // URLs to pass to the Agent
  // Map to store active agent instances per session
  private sessionAgents: Map<string, Agent> = new Map();

  /**
   * Creates an instance of the OrrinAiClient.
   * Stores adapter configurations and MCP server URLs.
   * @param config - Configuration including adapters and MCP server URLs.
   */
  constructor(config: OrrinAiClientConfig) {
    if (!config || !config.llmAdapter || !config.databaseAdapter) {
      throw new Error('OrrinAiClient requires llmAdapter and databaseAdapter.');
    }
    this.llmAdapter = config.llmAdapter;
    this.databaseAdapter = config.databaseAdapter;
    this.mcpServerUrls = config.mcpServerUrls || [];

    logger.info('OrrinAiClient initialized.'); // Use logger
    if (this.mcpServerUrls.length > 0) {
      logger.info('Configured MCP URLs:', this.mcpServerUrls); // Use logger
    } else {
        logger.info('No MCP servers configured for Agents.'); // Use logger
    }
  }

  /**
   * Creates a new session in the database only, without initializing an Agent.
   * Use openSession() after this to initialize and connect the Agent.
   * @returns The newly generated session ID.
   */
  async createSession(): Promise<string> {
    const sessionId = randomUUID();
    logger.info(`Attempting to create session in database: ${sessionId}`);
    
    try {
      // Create session entry in DB
      await this.databaseAdapter.createSession(sessionId);
      logger.info(`Database session created: ${sessionId}`);
      return sessionId;
    } catch (error) {
      logger.error(`Failed to create session ${sessionId} in database:`, error);
      throw error;
    }
  }

  /**
   * Opens an existing session by initializing an Agent instance,
   * connecting the Agent's resources, and storing it.
   * @param sessionId - The ID of the session to open
   * @throws Error if the session does not exist or initialization fails
   */
  async openSession(sessionId: string): Promise<void> {
    logger.info(`Attempting to open session: ${sessionId}`);
    
    try {
      // Check if session exists
      const session = await this.databaseAdapter.getSession(sessionId);
      if (!session) {
        logger.error(`Session ${sessionId} not found.`);
        throw new Error(`Session ${sessionId} not found. Create the session first.`);
      }
      
      // If agent is already initialized, close it first
      if (this.sessionAgents.has(sessionId)) {
        logger.info(`Session ${sessionId} already open, closing existing agent first.`);
        await this.closeSession(sessionId);
      }

      // Load existing messages for the session
      const initialMessages = await this.databaseAdapter.getMessages(sessionId);
      logger.info(`Loaded ${initialMessages.length} initial messages for session ${sessionId}.`);

      // Create and connect the agent for this session, passing initial messages
      logger.info(`Initializing Agent for session ${sessionId}...`);
      const agent = new Agent({ 
          llmAdapter: this.llmAdapter, 
          mcpServerUrls: this.mcpServerUrls,
          initialMessages, // Pass loaded history
      });

      try {
          await agent.connect(); // Connect agent's resources (e.g., MCPRouter)
          logger.info(`Agent connected for session ${sessionId}.`);
      } catch (connectError) {
          // Log connection error but allow session creation to succeed
          logger.error(`Agent failed to connect for session ${sessionId}:`, connectError);
          // Depending on requirements, could throw here to fail session opening
      }
      
      // Store the agent instance
      this.sessionAgents.set(sessionId, agent);
      logger.info(`Agent stored for session ${sessionId}.`);

    } catch (error) {
      logger.error(`Failed to open session ${sessionId}:`, error);
      // Clean up agent if it was partially created
      const agent = this.sessionAgents.get(sessionId);
      if (agent) {
          logger.info(`Cleaning up agent for failed session opening ${sessionId}...`);
          await agent.close();
          this.sessionAgents.delete(sessionId);
      }
      // Rethrow the error
      throw error;
    }
  }

  /**
   * Creates a new session and opens it in one operation.
   * This maintains backward compatibility with the original function.
   * @returns The newly generated session ID.
   */
  async createAndOpenSession(): Promise<string> {
    const sessionId = await this.createSession();
    try {
      await this.openSession(sessionId);
      return sessionId;
    } catch (error) {
      logger.error(`Failed to open newly created session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Closes the agent connections for a specific session and removes it from management.
   * @param sessionId The ID of the session to close.
   */
  async closeSession(sessionId: string): Promise<void> {
      const agent = this.sessionAgents.get(sessionId);
      if (agent) {
          logger.info(`Closing agent for session ${sessionId}...`); // Log info
          try {
              await agent.close();
              logger.info(`Agent closed for session ${sessionId}.`);
          } catch (closeError) {
              logger.error(`Error closing agent for session ${sessionId}:`, closeError);
          } finally {
             this.sessionAgents.delete(sessionId); 
          }
      } else {
          logger.warn(`No active agent found for session ${sessionId} to close.`); // Log warning
      }
  }

  /**
   * Closes all active session agents managed by this client.
   */
  async disconnectAll(): Promise<void> {
      logger.info(`Disconnecting all (${this.sessionAgents.size}) session agents...`); // Log info
      const closingPromises: Promise<void>[] = [];
      for (const [sessionId, agent] of this.sessionAgents.entries()) {
           logger.info(`Closing agent for session ${sessionId}...`); // Log info
           closingPromises.push(
               agent.close().catch(err => 
                   logger.error(`Error closing agent for session ${sessionId} during disconnectAll:`, err) // Log error
               )
           );
      }
      await Promise.allSettled(closingPromises);
      this.sessionAgents.clear();
      logger.info('All session agents disconnected.'); // Log info
  }

  /**
   * Adds a user message to a session, retrieves the agent, runs it,
   * saves messages, and yields streamed message updates as they occur.
   * @param sessionId - The ID of the session.
   * @param userMessageContent - The text content of the user's message.
   * @yields {Message | LLMCompletionChunk} Streamed chunks and composed messages.
   * @throws {Error} if the session ID is not found or has no associated agent.
   */
  async *addUserMessage(sessionId: string, userMessageContent: string): AsyncGenerator<ToolResultMessage | LLMCompletionChunk, void, undefined> {
    logger.info(`Processing user message for session ${sessionId}`);

    const agent = this.sessionAgents.get(sessionId);
    if (!agent) {
        logger.error(`No active agent found for session ${sessionId}. Cannot process message.`);
        throw new Error(`[OrrinAiClient] No active agent found for session ${sessionId}. Please open the session first.`);
    }

    try {
      // 1. Prepare User Message
      const userMessage: Message = {
          role: 'user',
          content: userMessageContent,
          createdAt: new Date(),
      };

      // 2. Save User Message (before processing)
      await this.databaseAdapter.addMessage(sessionId, userMessage);
      logger.info(`User message saved for session ${sessionId}.`);

      // Instantiate the accumulator for this run
      const accumulator = new MessageAccumulator();

      // 3. Process the new message using the agent and process yielded items
      logger.info(`Starting agent processing for session ${sessionId}...`);
      // Pass ONLY the new user message to the agent
      for await (const yieldedItem of agent.run(userMessage)) {
          // Yield the chunk or message immediately to the caller
          yield yieldedItem;

          let completedMessage: Message | null = null;

          // Feed raw chunks to the accumulator
          if (!('role' in yieldedItem)) { // Check if it's a chunk
              completedMessage = accumulator.addChunk(yieldedItem);
          }

          // 4. Save messages completed by the accumulator OR yielded directly by Agent
          if (completedMessage) {
              // Message completed by the accumulator (e.g., thinking, final assistant)
              logger.info(`Saving message (from accumulator) with role ${completedMessage.role} to DB for session ${sessionId}.`);
              await this.databaseAdapter.addMessage(sessionId, completedMessage);
          } else if ('role' in yieldedItem && (yieldedItem.role === 'tool_result')) {
              // Save tool_result messages yielded directly by the Agent
              // (Agent handles tool execution and yielding results)
              const yieldedMessage = yieldedItem; // Type assertion
              logger.info(`Saving ${yieldedMessage.role} message (from agent) to DB for session ${sessionId}.`);
              await this.databaseAdapter.addMessage(sessionId, yieldedMessage);
          } 
          // Note: We don't save the 'tool_use' message here because the accumulator
          // handles finalizing it based on stream_end. We also don't save partial assistant
          // messages; only the final one determined by the accumulator on stream_end.
      }
      logger.info(`Agent processing finished for session ${sessionId}.`);

    } catch (error) {
      logger.error(`Error during agent processing for session ${sessionId}:`, error);
      throw error;
    }
  }
}
