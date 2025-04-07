import type { LLMAdapter, LLMTool, Message, LLMToolCallRequest, LLMToolResult, LLMCompletionChunk } from '../index.js'; // Removed LLMAdapterResponse
import { MCPRouter } from './mcp-router.js'; // Import MCPRouter
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'; // Needed to create transports
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { URL } from 'url';
import { logger } from '../utils/logger.js'; // Import logger
import { MessageAccumulator } from '../utils/message-accumulator.js'; // Import the accumulator

interface AgentConfig {
    llmAdapter: LLMAdapter;
    // Changed from mcpRouter to mcpServerUrls
    mcpServerUrls: string[];
    // Add initialMessages to the config
    initialMessages?: Message[]; 
}

/**
 * Encapsulates the core LLM interaction loop and manages MCP connections for its duration.
 * Yields raw LLM stream chunks and completed tool result messages.
 */
export class Agent {
    private llmAdapter: LLMAdapter;
    private mcpRouter: MCPRouter; // Agent owns the router instance
    private mcpServerUrls: string[]; // Store for potential reference
    // Add internal message history
    private currentMessages: Message[] = [];

    constructor(config: AgentConfig) {
        if (!config || !config.llmAdapter) {
            throw new Error('Agent requires a configuration object with llmAdapter.');
        }
        this.llmAdapter = config.llmAdapter;
        this.mcpServerUrls = config.mcpServerUrls || [];
        // Initialize internal message history
        this.currentMessages = config.initialMessages ? [...config.initialMessages] : [];
        logger.info(`[Agent Constructor] Initialized with ${this.currentMessages.length} messages.`); // Log initial message count

        // Create transports from URLs
        const transports: Transport[] = this.mcpServerUrls.map(urlStr => {
            try {
                const url = new URL(urlStr);
                return new SSEClientTransport(url);
            } catch (error) {
                logger.error(`[Agent Constructor] Invalid MCP Server URL: ${urlStr}. Skipping.`, error); // Log error
                return null;
            }
        }).filter((transport): transport is SSEClientTransport => transport !== null);

        // Initialize the MCPRouter
        this.mcpRouter = new MCPRouter({ transports });
        logger.info(`[Agent Constructor] Initialized MCPRouter with ${transports.length} valid transport(s).`); // Log info
    }

    /**
     * Connects the internal MCPRouter.
     */
    async connect(): Promise<void> {
        if (this.mcpRouter.getIsConnected()) {
            logger.info('[Agent Connect] MCPRouter already connected.'); // Log info
            return;
        }
        logger.info('[Agent Connect] Connecting MCPRouter...'); // Log info
        try {
            await this.mcpRouter.connect();
            if (this.mcpRouter.getIsConnected()) {
                 logger.info('[Agent Connect] MCPRouter connected successfully.'); // Log info
            } else {
                 logger.warn('[Agent Connect] MCPRouter connect completed, but no active connections established.'); // Log warn
            }
        } catch (error) {
            logger.error('[Agent Connect] Error connecting MCPRouter:', error); // Log error
            throw error; // Re-throw connection error
        }
    }

    /**
     * Closes the internal MCPRouter connections.
     */
    async close(): Promise<void> {
         logger.info('[Agent Close] Closing MCPRouter connection...'); // Log info
         await this.mcpRouter.close().catch(closeErr => {
             logger.error("[Agent Close] Error closing MCPRouter:", closeErr); // Log error
             // Log error but don't throw from close
         });
         logger.info('[Agent Close] MCPRouter connection closed.'); // Log info
    }

    /**
     * Executes a single tool call and returns the resulting tool_result message.
     * @param toolCall The tool call request.
     * @returns A Promise resolving to the tool_result Message.
     */
    private async _executeToolCall(toolCall: LLMToolCallRequest): Promise<Message> {
        logger.info(`[Agent Run] Executing tool: ${toolCall.name} (ID: ${toolCall.id})`, toolCall.input);
        let toolResultData: string | Record<string, any>;
        let toolResultIsError = false;
        try {
            const result = await this.mcpRouter.callTool({
                name: toolCall.name,
                arguments: toolCall.input,
            });
            logger.info(`[Agent Run] Tool ${toolCall.name} (ID: ${toolCall.id}) executed.`);
            if (result.content && result.content.length > 0) {
                const firstPart = result.content[0];
                toolResultData = ('text' in firstPart) ? firstPart.text : JSON.stringify(firstPart);
            } else {
                toolResultData = '[No content returned by tool]';
                logger.warn(`[Agent Run] Tool ${toolCall.name} (ID: ${toolCall.id}) returned no content.`);
            }
            toolResultIsError = result.isError ?? false;
            if (toolResultIsError) {
                logger.warn(`[Agent Run] Tool ${toolCall.name} (ID: ${toolCall.id}) execution resulted in an error flag.`, result.content);
            }
        } catch (toolError) {
            logger.error(`[Agent Run] Error executing tool ${toolCall.name} (ID: ${toolCall.id}):`, toolError);
            toolResultData = `Error executing tool: ${toolError instanceof Error ? toolError.message : String(toolError)}`;
            toolResultIsError = true;
        }
        const toolResult: LLMToolResult = { tool_call_id: toolCall.id, content: toolResultData, is_error: toolResultIsError };
        const toolResultMessage: Message = {
            role: 'tool_result',
            content: typeof toolResultData === 'string' ? toolResultData : JSON.stringify(toolResultData),
            tool_result: toolResult,
            createdAt: new Date()
        };
        return toolResultMessage;
    }

    /**
     * Runs the agent interaction loop based on the provided initial messages.
     * Assumes connect() has been called successfully.
     * Yields raw LLMCompletionChunk events directly from the adapter, 
     * and yields completed Message objects only for tool results (role: 'tool_result').
     * @param initialMessages The starting message history for this run.
     */
    async *run(newMessage: Message): AsyncGenerator<LLMCompletionChunk | Message, void, undefined> {
        // Add the new message to the internal history
        this.currentMessages.push(newMessage);
        // Let currentMessages refer to the instance variable
        // let currentMessages = [...initialMessages]; // Remove this line
        let availableTools: LLMTool[] = [];

        if (!this.mcpRouter.getIsConnected()) {
            logger.warn('[Agent Run] MCPRouter is not connected. Proceeding without tools.');
            availableTools = [];
        } else {
             availableTools = this.mcpRouter.listTools();
             logger.info(`[Agent Run] Using ${availableTools.length} tools provided by connected MCPRouter.`);
        }

        try {
            let turn = 0;

            while (true) {
                turn++;
                // Use the internal message history
                logger.info(`[Agent Turn ${turn}] Calling LLM adapter stream with ${this.currentMessages.length} messages...`);

                let streamEnded = false;
                let llmError: Error | null = null;
                const accumulator = new MessageAccumulator();
                const pendingToolPromises: Map<string, Promise<Message>> = new Map(); // Track ongoing tool calls

                // 1. Process LLM Stream & Initiate Tool Calls
                const stream = this.llmAdapter.createCompletion(this.currentMessages, availableTools);
                for await (const chunk of stream) {
                    yield chunk; // Yield raw chunk immediately
                    
                    const completedMessage = accumulator.addChunk(chunk);
                    
                    if (completedMessage) {
                        // If a tool_use message is completed, start executing tools
                        if (completedMessage.role === 'tool_use' && completedMessage.tool_calls) {
                            logger.info(`[Agent Turn ${turn}] Accumulator completed tool_use message. Starting ${completedMessage.tool_calls.length} tool executions.`);
                            for (const toolCall of completedMessage.tool_calls) {
                                if (!pendingToolPromises.has(toolCall.id)) {
                                    const toolPromise = this._executeToolCall(toolCall);
                                    pendingToolPromises.set(toolCall.id, toolPromise);
                                } else {
                                     logger.warn(`[Agent Turn ${turn}] Attempted to start duplicate tool call ID: ${toolCall.id}`);
                                }
                            }
                        }
                    }

                    if (chunk.type === 'stream_end') {
                        streamEnded = true;
                        logger.info(`[Agent Turn ${turn}] Stream ended cleanly. Reason: ${chunk.reason}`);
                    } else if (chunk.type === 'error') {
                        llmError = chunk.error;
                        streamEnded = true;
                        logger.error(`[Agent Turn ${turn}] Stream ended with error:`, chunk.error);
                    }
                }
                // --- End Stream Processing ---

                if (llmError) throw llmError;
                if (!streamEnded) throw new Error("LLM stream ended unexpectedly.");

                // 2. Add Accumulated Messages to History
                // Includes thinking, final assistant, and the tool_use message (if any)
                // Add to the internal message history
                this.currentMessages.push(...accumulator.getCompletedMessages()); 
                
                // 3. Wait for Tools and Process Results (if any were started)
                if (pendingToolPromises.size > 0) {
                    logger.info(`[Agent Turn ${turn}] Waiting for ${pendingToolPromises.size} pending tool call(s) to complete...`);
                    const settledResults = await Promise.allSettled(pendingToolPromises.values());
                    
                    const toolResultMessages: Message[] = [];
                    const fulfilledToolMessages: Message[] = [];

                    settledResults.forEach((result, index) => {
                         // Find original tool call ID (requires knowing the order or storing IDs alongside promises)
                         // Let's assume order is preserved for simplicity, but a Map iteration might be safer
                         const toolCallId = Array.from(pendingToolPromises.keys())[index]; 
                         if (result.status === 'fulfilled') {
                             const toolResultMessage = result.value; // This is the Message object
                             fulfilledToolMessages.push(toolResultMessage);
                             toolResultMessages.push(toolResultMessage);
                             logger.info(`[Agent Turn ${turn}] Tool call ${toolCallId} completed successfully.`);
                         } else {
                             logger.error(`[Agent Run] Tool call ${toolCallId} execution failed:`, result.reason);
                             // Create an error message to yield and add to history
                             const errorResult: LLMToolResult = { tool_call_id: toolCallId, content: `Tool execution failed: ${result.reason}`, is_error: true };
                             const errorMessage: Message = {
                                 role: 'tool_result',
                                 content: typeof errorResult.content === 'string' 
                                             ? errorResult.content 
                                             : JSON.stringify(errorResult.content),
                                 tool_result: errorResult,
                                 createdAt: new Date()
                             };
                              fulfilledToolMessages.push(errorMessage); // Yield the error representation
                              toolResultMessages.push(errorMessage); // Add error representation to history
                         }
                    });
                    
                    // Yield the collected tool_result messages (success or error)
                    for (const toolMessage of fulfilledToolMessages) {
                         yield toolMessage; 
                    }

                    // Add the completed tool results to the main message history 
                    // Add to the internal message history
                    this.currentMessages.push(...toolResultMessages); 

                    logger.info(`[Agent Turn ${turn}] Finished tool execution. Proceeding to next LLM call.`);
                    // Loop continues automatically
                } else {
                    // --- No Tools Called Path --- 
                    logger.info(`[Agent Turn ${turn}] No tools were executed. Ending run.`);
                    return; // <<< Loop Exit: Final Response or no tools initiated
                }
            } // End while(true)

        } catch (error) {
            logger.error("[Agent Run] Error during agent run loop:", error);
            throw error;
        }
    }
} 