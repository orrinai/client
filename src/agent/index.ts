import type { LLMAdapter, LLMTool, Message, LLMToolCallRequest, LLMToolResult, LLMCompletionChunk, ToolResultMessage } from '../session-manager.js'; // Removed LLMAdapterResponse
import { MCPRouter } from './mcp-router.js'; // Import MCPRouter
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'; // Needed to create transports
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { URL } from 'url';
import { logger } from '../utils/logger.js'; // Import logger
import { MessageAccumulator } from '../utils/message-accumulator.js'; // Import the accumulator

export interface AgentConfig {
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
     * Executes a single tool call and returns the resulting tool_result object.
     * @param toolCall The tool call request.
     * @returns A Promise resolving to the LLMToolResult object.
     */
    private async _executeToolCall(toolCall: LLMToolCallRequest): Promise<LLMToolResult> {
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
        return toolResult;
    }

    /**
     * Runs the agent interaction loop based on the provided initial messages.
     * Assumes connect() has been called successfully.
     * Yields raw LLMCompletionChunk events directly from the adapter, 
     * and yields completed Message objects only for tool results (role: 'tool_result').
     * @param initialMessages The starting message history for this run.
     */
    async *run(newMessage: Message): AsyncGenerator<LLMCompletionChunk | ToolResultMessage, void, undefined> {
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
                const pendingToolPromises: Map<string, Promise<LLMToolResult>> = new Map(); // Track ongoing tool calls

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

                // 2. Add Accumulated Messages (thinking, assistant, tool_use) to History
                const accumulatedMessages = accumulator.getCompletedMessages();
                this.currentMessages.push(...accumulatedMessages);
                logger.info(`[Agent Turn ${turn}] Added ${accumulatedMessages.length} messages from accumulator to history.`);

                // 3. Process Tool Results Sequentially Based on Tool Use Messages
                const generatedToolResultMessages: Message[] = [];
                let processedAnyTools = false;

                // Iterate through only the messages accumulated in *this* turn
                for (const toolUseMessage of accumulatedMessages) {
                    // Skip messages that are not tool_use messages
                    if (toolUseMessage.role !== 'tool_use') {
                        continue;
                    }
                    // We now know it's a tool_use message, check if it actually has calls
                    if (!toolUseMessage.tool_calls || toolUseMessage.tool_calls.length === 0) {
                        // Log a warning if a tool_use message somehow has no calls
                        logger.warn(`[Agent Turn ${turn}] Encountered tool_use message with no tool_calls array or empty array.`);
                        continue;
                    }

                    processedAnyTools = true; // Mark that we found at least one tool_use message
                    const currentToolResults: LLMToolResult[] = [];
                    const toolCallIds = toolUseMessage.tool_calls.map(tc => tc.id);
                    logger.info(`[Agent Turn ${turn}] Processing results for tool_use message containing calls: ${toolCallIds.join(', ')}`);

                    for (const toolCall of toolUseMessage.tool_calls) {
                        const toolCallId = toolCall.id;
                        const toolPromise = pendingToolPromises.get(toolCallId);
                        pendingToolPromises.delete(toolCallId); // Remove processed promise

                        if (!toolPromise) {
                             logger.error(`[Agent Turn ${turn}] Logic Error: No pending promise found for tool call ID: ${toolCallId}`);
                             // Create an error result
                             const errorResult: LLMToolResult = { tool_call_id: toolCallId, content: `Internal error: Tool execution promise not found.`, is_error: true };
                             currentToolResults.push(errorResult);
                             continue;
                        }

                        try {
                            const result = await toolPromise;
                            currentToolResults.push(result);
                            logger.info(`[Agent Turn ${turn}] Successfully awaited result for tool call ID: ${toolCallId}`);
                        } catch (error) {
                            logger.error(`[Agent Turn ${turn}] Error awaiting tool call ${toolCallId}:`, error);
                            const errorResult: LLMToolResult = { tool_call_id: toolCallId, content: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`, is_error: true };
                            currentToolResults.push(errorResult);
                        }
                    }

                    // Construct the single tool_result message for this batch
                    const toolResultMessage: Message = {
                        role: 'tool_result',
                        // Use 'tool_results' (plural) which expects an array
                        tool_results: currentToolResults,
                        // Content might be null or derived if needed by specific APIs
                        content: null, // Or e.g., JSON.stringify(currentToolResults.map(r => r.content))
                        createdAt: new Date()
                    };

                    yield toolResultMessage; // Yield the combined result message
                    generatedToolResultMessages.push(toolResultMessage); // Add to list for history update
                    logger.info(`[Agent Turn ${turn}] Yielded combined tool_result message for calls: ${toolCallIds.join(', ')}`);
                } // End for loop over accumulatedMessages

                // 4. Add Generated Tool Result Messages to History
                if (generatedToolResultMessages.length > 0) {
                    this.currentMessages.push(...generatedToolResultMessages);
                    logger.info(`[Agent Turn ${turn}] Added ${generatedToolResultMessages.length} generated tool_result messages to history.`);
                }

                // Check for any remaining pending promises (shouldn't happen in this logic)
                if (pendingToolPromises.size > 0) {
                     logger.error(`[Agent Turn ${turn}] Logic Error: ${pendingToolPromises.size} tool promises remained pending after processing.`);
                     // Decide how to handle this - maybe create error results for them?
                     // For now, just log.
                }


                // 5. Decide whether to continue
                if (processedAnyTools) {
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