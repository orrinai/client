import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages';
type AnthropicClientOptions = ConstructorParameters<typeof Anthropic>[0];
// Update import path for index types
import type { 
    LLMAdapter, 
    Message, 
    LLMTool, 
    LLMCompletionChunk
} from '@orrin-ai/mcp-agent';
// Update import path for logger
import { logger } from "@orrin-ai/mcp-agent";

// Define the specific structure Anthropic expects for the tool's input schema
// It must have type: "object" and allow arbitrary other properties (index signature)
interface AnthropicToolInputSchema {
    type: "object";
    properties: Record<string, Record<string, any>>; // Basic JSON schema object structure for properties
    required?: string[];
    description?: string;
    [key: string]: any; // Index signature to allow other properties
}

// Separate configuration options for the adapter itself
interface ClaudeAdapterOptions {
    model?: string; // Allow specifying Claude model per adapter instance
}

/**
 * An LLMAdapter implementation for Anthropic's Claude models.
 * Supports streaming completions.
 */
export class ClaudeAdapter implements LLMAdapter {
    private anthropic: Anthropic;
    private model: string;

    /**
     * Creates an instance of ClaudeAdapter.
     *
     * @param config - Can be an existing Anthropic client instance, Anthropic client options,
     *                 or an object containing both client options and adapter options.
     *                 If apiKey is missing, it attempts to load from ANTHROPIC_API_KEY env var.
     */
    constructor(config?: Anthropic | (AnthropicClientOptions & ClaudeAdapterOptions) | null | undefined) {
        if (config instanceof Anthropic) {
            this.anthropic = config;
            this.model = (config as any).model || 'claude-3-opus-20240229';
            logger.info("[ClaudeAdapter] Using provided Anthropic client instance.");
        } else {
            // Treat config as potentially combined options, default to empty object if null/undefined
            const combinedOptions = config || {};
            // Extract client options - careful not to include adapter-specific 'model'
            // Use type assertion to help TypeScript separate the types
            const { model, ...clientOptions } = combinedOptions as ClaudeAdapterOptions & AnthropicClientOptions;

            // Ensure API key exists
            if (!clientOptions.apiKey) {
                clientOptions.apiKey = process.env.ANTHROPIC_API_KEY;
                if (!clientOptions.apiKey) {
                    throw new Error('ClaudeAdapter requires an API key. Provide it in the constructor options or set ANTHROPIC_API_KEY environment variable.');
                }
                logger.info("[ClaudeAdapter] Loaded API key from ANTHROPIC_API_KEY.");
            }

            this.anthropic = new Anthropic(clientOptions);
            this.model = model || 'claude-3-opus-20240229'; // Use provided model or default
            logger.info(`[ClaudeAdapter] Initialized new Anthropic client for model: ${this.model}`);
        }
    }

    /**
     * Converts the generic LLMTool format to Anthropic's Tool format.
     * Validates that the input tool's input_schema conforms to AnthropicToolInputSchema.
     */
    private formatToolsForAnthropic(tools?: LLMTool[]): AnthropicTool[] | undefined {
        if (!tools || tools.length === 0) {
            return undefined;
        }

        return tools.map((tool): AnthropicTool => { // Explicitly return AnthropicTool
             // Validate the input schema from the generic LLMTool
            if (typeof tool.input_schema !== 'object' || tool.input_schema === null || tool.input_schema.type !== 'object') {
                 logger.error(`[ClaudeAdapter] Invalid input_schema for tool '${tool.name}'. It must be an object with type: "object". Received:`, tool.input_schema);
                 throw new Error(`Invalid input_schema for tool '${tool.name}'. Must have type: \\"object\\".`);
            }
            // Further ensure 'properties' exists and is an object, as required by our stricter interface
            if (typeof tool.input_schema.properties !== 'object' || tool.input_schema.properties === null) {
                 logger.error(`[ClaudeAdapter] Invalid input_schema for tool '${tool.name}'. Missing or invalid 'properties' object.`);
                 throw new Error(`Invalid input_schema for tool '${tool.name}'. Missing 'properties' object.`);
            }

            // Cast the validated schema and map
            const validatedSchema = tool.input_schema as AnthropicToolInputSchema;

            return {
                name: tool.name,
                description: tool.description,
                input_schema: validatedSchema // Now conforms to the interface + index signature
            };
        });
    }

    /**
     * Converts internal Message format to Anthropic's MessageParam format.
     * Handles tool role messages correctly.
     */
    private formatMessagesForAnthropic(messages: Message[]): MessageParam[] {
        const formattedMessages: MessageParam[] = [];

        if (messages.length === 0) {
            logger.warn("[ClaudeAdapter] Message list is empty.");
            return [];
        }

        // Ensure conversation starts with user or assistant/thinking
        const firstRole = messages[0].role;
        if (firstRole !== 'user' && firstRole !== 'assistant' && firstRole !== 'assistant_thinking') {
            logger.warn(`[ClaudeAdapter] Conversation starts with invalid role '${firstRole}'. Prepending placeholder user message.`);
            formattedMessages.push({ role: 'user', content: '(Start of conversation)' });
        }

        // Use an index-based loop instead of for-of to control iteration
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            // --- 1. Determine MessageParam based on input message and push directly ---
            if (msg.role === 'user') {
                 formattedMessages.push({ // Push directly
                     role: 'user',
                     content: msg.content ?? ""
                 });
            } else if (msg.role === 'assistant_thinking') {
                // Look ahead to see if the next message is an assistant message
                const nextMsg = i < messages.length - 1 ? messages[i + 1] : null;
                
                if (nextMsg && nextMsg.role === 'assistant') {
                    // Combine assistant_thinking with the next assistant message
                    formattedMessages.push({
                        role: 'assistant',
                        content: (msg.content ? `<thinking>${msg.content}</thinking>` : "") + 
                                  (nextMsg.content ?? "")
                    });
                    
                    // Skip the next message by advancing the loop counter
                    i++;
                } else {
                    // No assistant message follows, push thinking message normally
                    formattedMessages.push({
                        role: 'assistant',
                        content: msg.content ? `<thinking>${msg.content}</thinking>` : ""
                    });
                }
           } else if (msg.role === 'assistant') {
                 formattedMessages.push({ // Push directly
                     role: 'assistant',
                     content: msg.content ?? ""
                 });
            } else if (msg.role === 'tool_use') {
                 if (msg.tool_calls && msg.tool_calls.length > 0) {
                      formattedMessages.push({ // Push directly
                          role: 'assistant',
                          content: msg.tool_calls.map(call => ({
                              type: 'tool_use' as const,
                              id: call.id,
                              name: call.name,
                              input: call.input
                          }))
                      });
                      if (msg.content) {
                          logger.warn(`[ClaudeAdapter] Message with role 'tool_use' also has text content. Ignoring text content.`);
                      }
                 } else {
                     logger.warn(`[ClaudeAdapter] Message with role 'tool_use' has no tool_calls. Skipping.`);
                 }
            } else if (msg.role === 'tool_result') {
                // Tool results are added separately below, *after* the assistant message
                const lastFormattedMsg = formattedMessages[formattedMessages.length - 1];
                 if (lastFormattedMsg?.role === 'assistant' && Array.isArray(lastFormattedMsg.content) && lastFormattedMsg.content.some(block => block.type === 'tool_use')) {
                      // Add the tool result as a NEW user message
                      formattedMessages.push({
                          role: 'user',
                          content: msg.tool_results.map(result => ({
                              type: 'tool_result',
                              tool_use_id: result.tool_call_id, // Assert non-null
                              content: typeof result.content === 'string'
                                          ? result.content
                                          : JSON.stringify(result.content),
                              is_error: result.is_error
                          }))
                      });
                  } else {
                      logger.error(`[ClaudeAdapter] Tool result message does not immediately follow an assistant message requesting tools in the formatted list. Skipping tool result.`);
                  }
            } else {
                 logger.warn(`[ClaudeAdapter] Skipping message with unknown role: ${msg.role}`);
            }

            // --- Section 2 (Adding messageToAdd) is removed ---
            
        } // End messages loop

        return formattedMessages;
    }

    /**
     * Processes messages and tools to get a completion from Claude.
     * Streams the response using the 11 granular LLMCompletionChunk events.
     */
    async *createCompletion(messages: Message[], tools?: LLMTool[]): AsyncGenerator<LLMCompletionChunk, void, undefined> {
        const anthropicMessages = this.formatMessagesForAnthropic(messages);
        if (anthropicMessages.length === 0) {
             logger.error("[ClaudeAdapter] Cannot create completion: formatted message list is empty.");
             yield { type: 'error', error: new Error("Cannot create completion: formatted message list is empty.") };
             return;
        }
        const anthropicTools = this.formatToolsForAnthropic(tools);

        logger.info(`[ClaudeAdapter] Starting stream to Claude model ${this.model} with ${anthropicMessages.length} messages...`);
        if (anthropicTools) {
             logger.info(`[ClaudeAdapter] Providing ${anthropicTools.length} tools.`);
        }

        // --- State variables LOCAL TO THIS CALL --- 
        let currentTextBuffer = "";
        let parserState: 'IDLE' | 'TEXT' | 'THINKING' = 'IDLE';
        let activeBlockType: 'text' | 'tool_use' | null = null;
        let activeToolCallId: string | null = null;

        // --- Helper functions defined INSIDE createCompletion (as closures) --- 
        
        // Helper to yield final end event based on state
        function *yieldCurrentStateEnd(): Generator<LLMCompletionChunk> {
            if (parserState === 'TEXT') {
                yield { type: 'text_end' };
            } else if (parserState === 'THINKING') {
                yield { type: 'thinking_end' };
            }
            // State reset happens after calling this
        }

        // Generator method to parse the buffer based on state
        function *parseNextInBuffer(isFinalChunk: boolean = false): Generator<LLMCompletionChunk, number> { // Returns processed length
            const thinkingStartTag = "<thinking>";
            const thinkingEndTag = "</thinking>";
            let processedLength = 0;

            if (currentTextBuffer.length === 0) {
                return 0; // Nothing to process
            }

            switch (parserState) {
                case 'IDLE': {
                    // Expecting text or <thinking>
                    const startIndex = currentTextBuffer.indexOf(thinkingStartTag);
                    const ltIndex = currentTextBuffer.indexOf('<');

                    if (startIndex === 0) { // Starts immediately with <thinking>
                        yield { type: 'thinking_start' };
                        parserState = 'THINKING'; // Update local state
                        processedLength = thinkingStartTag.length;
                    } else if (startIndex > 0) { // Text exists before <thinking>
                        const textBefore = currentTextBuffer.substring(0, startIndex);
                        yield { type: 'text_start' };
                        yield { type: 'text_delta', delta: textBefore };
                        yield { type: 'text_end' }; // End text block before thinking
                        yield { type: 'thinking_start' };
                        parserState = 'THINKING'; // Update local state
                        processedLength = startIndex + thinkingStartTag.length;
                    } else if (ltIndex === 0) { // Starts with '<'
                        // Potentially incomplete <thinking> tag?
                        if (!isFinalChunk && currentTextBuffer.length < thinkingStartTag.length) {
                            // Need more data to be sure
                            processedLength = 0; // Wait
                        } else { // Treat as literal text (either final chunk or long enough to know)
                            yield { type: 'text_start' };
                            yield { type: 'text_delta', delta: '<' };
                            parserState = 'TEXT'; // Update local state
                            processedLength = 1;
                        }
                    } else if (ltIndex > 0) { // Text before a '<'
                         // Potentially incomplete <thinking> tag?
                        if (!isFinalChunk && currentTextBuffer.length < ltIndex + thinkingStartTag.length) {
                             // Yield text before '<' and wait
                            const textBefore = currentTextBuffer.substring(0, ltIndex);
                            yield { type: 'text_start' };
                            yield { type: 'text_delta', delta: textBefore };
                            parserState = 'TEXT'; // Update local state
                            processedLength = ltIndex; // Don't process '<' yet
                        } else { // Treat '<' as literal text
                            const textToProcess = currentTextBuffer.substring(0, ltIndex + 1);
                             yield { type: 'text_start' };
                             yield { type: 'text_delta', delta: textToProcess};
                             parserState = 'TEXT'; // Update local state
                             processedLength = ltIndex + 1;
                        }
                    } else { // No '<' found at all, it's all text
                        yield { type: 'text_start' };
                        yield { type: 'text_delta', delta: currentTextBuffer };
                        parserState = 'TEXT'; // Update local state
                        processedLength = currentTextBuffer.length;
                    }
                    break;
                } // End IDLE

                case 'TEXT': {
                    yield { type: 'text_delta', delta: currentTextBuffer };
                    processedLength = currentTextBuffer.length;
                    break;
                } // End TEXT

                case 'THINKING': {
                    // Expecting more thinking or </thinking>
                    const endIndex = currentTextBuffer.indexOf(thinkingEndTag);
                    const ltIndex = currentTextBuffer.indexOf('<');

                    if (endIndex !== -1) { // Found </thinking>
                        const thinkingText = currentTextBuffer.substring(0, endIndex);
                        if (thinkingText) yield { type: 'thinking_delta', delta: thinkingText };
                        yield { type: 'thinking_end' };
                        parserState = 'IDLE'; // Update local state
                        processedLength = endIndex + thinkingEndTag.length;
                    } else if (ltIndex !== -1 && currentTextBuffer.startsWith('</', ltIndex)) { // Found '</'
                        // Potentially incomplete </thinking> tag?
                        if (!isFinalChunk && currentTextBuffer.length < ltIndex + thinkingEndTag.length) {
                            // Yield thinking text before '</' and wait
                            const thinkingText = currentTextBuffer.substring(0, ltIndex);
                            if (thinkingText) yield { type: 'thinking_delta', delta: thinkingText };
                            processedLength = ltIndex; // Don't process '</' yet
                        } else { // Treat '</' as literal thinking text
                             const textToProcess = currentTextBuffer.substring(0, ltIndex + 1); // Process '<'
                             yield { type: 'thinking_delta', delta: textToProcess };
                             processedLength = ltIndex + 1;
                        }
                    } else { // No relevant tag sequence, all thinking text
                         // Check for '<' which isn't part of '</thinking>'
                         if (ltIndex !== -1) {
                             // Process text up to the '<'
                             const thinkingTextBefore = currentTextBuffer.substring(0, ltIndex);
                             if(thinkingTextBefore) yield { type: 'thinking_delta', delta: thinkingTextBefore };
                             yield { type: 'thinking_delta', delta: '<' }; // Yield '<' as literal
                             processedLength = ltIndex + 1;
                         } else {
                            // Process the whole buffer as thinking text
                             yield { type: 'thinking_delta', delta: currentTextBuffer };
                             processedLength = currentTextBuffer.length;
                         }
                    }
                    break;
                } // End THINKING
            } // End switch

            // Ensure processedLength is non-negative and not greater than buffer length
            processedLength = Math.max(0, Math.min(processedLength, currentTextBuffer.length));

            return processedLength;
        } // End parseNextInBuffer

        // --- End of helper function definitions ---

        try {
            const stream = await this.anthropic.messages.stream({
                model: this.model,
                max_tokens: 4096,
                messages: anthropicMessages,
                tools: anthropicTools,
                // stream_options: { include_usage: true } // Removed: Not a valid parameter
            });

            for await (const event of stream) {
                switch (event.type) {
                    case 'message_start':
                        yield { type: 'stream_start' };
                        logger.debug("[ClaudeAdapter] Stream started.");
                        // Reset LOCAL state here
                        currentTextBuffer = "";
                        parserState = 'IDLE';
                        activeBlockType = null;
                        activeToolCallId = null;
                        break;

                    case 'content_block_start':
                        logger.debug("[ClaudeAdapter] Content block started:", event.content_block);
                        const block = event.content_block;
                        // Update activeBlockType based on Anthropic's block
                        activeBlockType = block.type === 'tool_use' ? 'tool_use' : (block.type === 'text' ? 'text' : null);

                        if (activeBlockType === 'text') {
                            currentTextBuffer = ""; // Reset buffer for new text block
                            parserState = 'IDLE';  // Reset parser state
                        } else if (activeBlockType === 'tool_use') {
                            // Add explicit type check for block here
                            if (block.type === 'tool_use') {
                                activeToolCallId = block.id;
                                yield { type: 'tool_use_start', id: block.id, name: block.name };
                            } else {
                                // This case should technically not be reachable if activeBlockType logic is correct
                                logger.error("[ClaudeAdapter] Internal state mismatch: activeBlockType is 'tool_use' but block type is not.");
                            }
                        } else {
                            logger.warn(`[ClaudeAdapter] Received unexpected content_block_start type: ${(block as any).type}`);
                            parserState = 'IDLE'; // Reset parser state just in case
                        }
                        break;

                    case 'content_block_delta':
                        const delta = event.delta;
                        if (delta.type === 'text_delta' && activeBlockType === 'text') {
                            currentTextBuffer += delta.text; // Append new chunk

                            // Process buffer loop - uses local state via closure
                            while (true) {
                                const processed = yield* parseNextInBuffer(); // Use the generator
                                if (processed > 0) {
                                    // Consume buffer only if something was processed
                                    currentTextBuffer = currentTextBuffer.substring(processed);
                                } else if (currentTextBuffer.length > 0) {
                                    // No progress made, must need more data
                                    break;
                                } else {
                                    // Buffer empty
                                    break;
                                }
                            } // End while loop processing buffer

                        } else if (delta.type === 'input_json_delta' && activeBlockType === 'tool_use' && activeToolCallId) {
                             yield { type: 'tool_use_delta', id: activeToolCallId, delta: delta.partial_json };
                        } else if (delta.type === 'text_delta' && activeBlockType !== 'text') {
                             logger.warn("[ClaudeAdapter] Received text_delta but active block type is not text.");
                        } else if (delta.type === 'input_json_delta' && (activeBlockType !== 'tool_use' || !activeToolCallId)) {
                             logger.warn("[ClaudeAdapter] Received input_json_delta but active block is not tool_use or ID is missing.");
                        }
                        break;

                    case 'content_block_stop':
                        logger.debug("[ClaudeAdapter] Content block stopped. Index:", event.index);

                        // Force processing of any remaining buffered text content for text blocks
                        if (activeBlockType === 'text') {
                            while (currentTextBuffer.length > 0) {
                                const processed = yield* parseNextInBuffer(true); // Force process remaining
                                if (processed > 0) {
                                     currentTextBuffer = currentTextBuffer.substring(processed);
                                } else {
                                     logger.warn("[ClaudeAdapter] Buffer processing stopped unexpectedly during content_block_stop final parse.");
                                     currentTextBuffer = ""; // Clear buffer to prevent infinite loop
                                     break;
                                }
                            }
                            // Yield the final end event for the state we finished in
                            yield* yieldCurrentStateEnd();
                            parserState = 'IDLE'; // Reset state after block finishes
                        }

                        // Yield the appropriate end event for tool use blocks
                        if (activeBlockType === 'tool_use' && activeToolCallId) {
                            yield { type: 'tool_use_end', id: activeToolCallId };
                            // Don't reset activeToolCallId here, message_stop might have final details
                        }

                        // Don't reset activeBlockType here, wait for message_stop or next content_block_start
                        break;

                    case 'message_delta':
                        // Captures stop_reason and usage deltas if include_usage=true
                        logger.debug("[ClaudeAdapter] Message delta event:", event.delta, event.usage);
                        break;

                    case 'message_stop':
                        logger.info(`[ClaudeAdapter] Stream finished`);

                        // Final cleanup: Process any remaining buffer and yield final end state
                        // (Safeguard in case content_block_stop didn't fire or buffer remained)
                         if (activeBlockType === 'text') {
                            while (currentTextBuffer.length > 0) {
                                const processed = yield* parseNextInBuffer(true); // Force process remaining
                                if (processed > 0) {
                                     currentTextBuffer = currentTextBuffer.substring(processed);
                                } else {
                                     logger.warn("[ClaudeAdapter] Buffer processing stopped unexpectedly during message_stop final parse.");
                                     currentTextBuffer = "";
                                     break;
                                }
                            }
                            yield* yieldCurrentStateEnd();
                         } else if (activeBlockType === 'tool_use' && activeToolCallId) {
                             // Ensure tool_use_end is yielded if not already by content_block_stop
                             // This might be redundant but safe. Requires tracking if end was yielded.
                             // Let's assume content_block_stop is reliable for now.
                         }

                        // Reset all LOCAL state definitively
                        parserState = 'IDLE';
                        currentTextBuffer = "";
                        activeBlockType = null;
                        activeToolCallId = null;

                        // Yield stream_end
                        yield { type: 'stream_end' };
                        break;

                     // Removed 'error' case here; handled by outer try/catch
                }
            }
            logger.info("[ClaudeAdapter] Stream processing complete.");

        } catch (error) {
            logger.error("[ClaudeAdapter] Error during Anthropic API stream processing:", error);
            // Yield an error chunk
            yield { type: 'error', error: new Error(`Anthropic API stream processing error: ${error instanceof Error ? error.message : String(error)}`) };
            // Consider yielding stream_end here? Maybe not, error signals termination.
        } finally {
             // Ensure LOCAL state is reset even if loop terminates unexpectedly
             // NOTE: These are local vars, so they reset on next call anyway, but good practice
             parserState = 'IDLE';
             currentTextBuffer = "";
        }
    }
} 