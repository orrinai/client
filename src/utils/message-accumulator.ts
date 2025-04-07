import type { LLMCompletionChunk, Message, LLMToolCallRequest, LLMToolResult } from '../session-manager.js';
import { logger } from './logger.js';

// Helper type for accumulating tool call data locally
type AccumulatingToolCallData = {
    id: string;
    name: string;
    argsJson: string;
};

/**
 * Accumulates LLMCompletionChunks into complete Message objects.
 * Manages internal state for building messages based on chunk types.
 */
export class MessageAccumulator {
    private currentRole: 'assistant' | 'assistant_thinking' | null = null;
    private currentContent: string = "";
    private currentToolCalls: Map<string, AccumulatingToolCallData> = new Map();
    private completedToolCalls: LLMToolCallRequest[] = [];
    private allCompletedMessages: Message[] = [];

    /**
     * Processes an incoming LLMCompletionChunk and potentially returns a completed Message.
     * @param chunk The LLMCompletionChunk to process.
     * @returns A completed Message object if the chunk completes one, otherwise null.
     */
    addChunk(chunk: LLMCompletionChunk): Message | null {
        let completedMessage: Message | null = null;

        switch (chunk.type) {
            case 'text_start':
                if (this.currentRole !== null) {
                    logger.warn('[Accumulator] Received text_start while already processing a message. Starting new assistant message.');
                    // Potentially finalize previous message? For now, just reset.
                    this.resetState('assistant');
                }
                this.currentRole = 'assistant';
                this.currentContent = "";
                break;

            case 'text_delta':
                if (this.currentRole !== 'assistant') {
                    // If not currently building an assistant message, start one.
                    // This handles cases where text starts without an explicit text_start.
                    if (this.currentRole !== null) {
                         logger.warn(`[Accumulator] Received text_delta during ${this.currentRole} state. Switching to assistant.`);
                         // Should we finalize here? Risky.
                    }
                    this.resetState('assistant');
                }
                this.currentContent += chunk.delta;
                break;

            case 'text_end':
                if (this.currentRole === 'assistant') {
                    // We don't finalize based on text_end alone, wait for stream_end or tool_use start
                    logger.debug('[Accumulator] Text block ended.');
                } else {
                    logger.warn('[Accumulator] Received text_end but not in assistant state.');
                }
                break;

            case 'thinking_start':
                 if (this.currentRole !== null) {
                    logger.warn('[Accumulator] Received thinking_start while already processing a message. Starting new thinking message.');
                    // Finalize previous? For now, just reset.
                    this.resetState('assistant_thinking');
                }
                this.currentRole = 'assistant_thinking';
                this.currentContent = "";
                break;

            case 'thinking_delta':
                if (this.currentRole !== 'assistant_thinking') {
                    // If not currently building a thinking message, start one.
                    if (this.currentRole !== null) {
                         logger.warn(`[Accumulator] Received thinking_delta during ${this.currentRole} state. Switching to thinking.`);
                    }
                     this.resetState('assistant_thinking');
                }
                this.currentContent += chunk.delta;
                break;

            case 'thinking_end':
                 if (this.currentRole === 'assistant_thinking') {
                     completedMessage = {
                         role: 'assistant_thinking',
                         content: this.currentContent,
                         createdAt: new Date()
                     };
                     this.resetState();
                 } else {
                     logger.warn('[Accumulator] Received thinking_end but not in thinking state.');
                 }
                break;

            case 'tool_use_start':
                // If we were building a text message, finalize it *before* starting tools.
                 if (this.currentRole === 'assistant' && this.currentContent) {
                     completedMessage = {
                         role: 'assistant',
                         content: this.currentContent,
                         createdAt: new Date()
                     };
                     this.resetState();
                 }
                 // If we were thinking, end that message (should happen via thinking_end ideally)
                 else if (this.currentRole === 'assistant_thinking' && this.currentContent) {
                      logger.warn('[Accumulator] tool_use_start received during thinking state. Finalizing thinking message.');
                      completedMessage = {
                         role: 'assistant_thinking',
                         content: this.currentContent,
                         createdAt: new Date()
                     };
                     this.resetState();
                 }
                 
                // Start accumulating this tool call
                this.currentToolCalls.set(chunk.id, { 
                    id: chunk.id, 
                    name: chunk.name, 
                    argsJson: ""
                });
                // We don't set currentRole here; tool calls are collected until stream_end or text starts again.
                break;

            case 'tool_use_delta':
                 const accumulatingCall = this.currentToolCalls.get(chunk.id);
                 if (accumulatingCall) {
                     accumulatingCall.argsJson += chunk.delta;
                 } else {
                     logger.warn(`[Accumulator] Received tool_use_delta for unknown ID: ${chunk.id}`);
                 }
                break;

            case 'tool_use_end':
                 const finishedCallData = this.currentToolCalls.get(chunk.id);
                 if (finishedCallData) {
                     try {
                         const inputArgs = JSON.parse(finishedCallData.argsJson || "{}");
                         this.completedToolCalls.push({ 
                             id: finishedCallData.id,
                             name: finishedCallData.name,
                             input: inputArgs
                         });
                         logger.debug(`[Accumulator] Completed tool call ${finishedCallData.name} (ID: ${finishedCallData.id}) buffered.`);
                     } catch (parseError) {
                         logger.error(`[Accumulator] Failed to parse JSON arguments for tool call ID ${chunk.id}: ${finishedCallData.argsJson}`, parseError);
                         // Skip adding this tool call
                     }
                     this.currentToolCalls.delete(chunk.id); // Remove from map
                 } else {
                     logger.warn(`[Accumulator] Received tool_use_end for unknown or already finished ID: ${chunk.id}`);
                 }
                 // Don't create a message yet, wait for stream_end
                 break;
            
            case 'stream_start':
                this.resetState(); // Reset everything on new stream
                break;

            case 'stream_end':
                // Stream has ended, finalize any pending message.
                if (this.completedToolCalls.length > 0) {
                    // Finalize as a tool_use message
                    completedMessage = {
                        role: 'tool_use',
                        content: this.currentContent || null, // Include any preceding text
                        tool_calls: [...this.completedToolCalls], // Clone array
                        createdAt: new Date()
                    };
                } else if (this.currentRole === 'assistant' && this.currentContent) {
                    // Finalize as a standard assistant message
                    completedMessage = {
                        role: 'assistant',
                        content: this.currentContent,
                        createdAt: new Date()
                    };
                } else if (this.currentRole === 'assistant_thinking' && this.currentContent) {
                     // Should have ended with thinking_end, but finalize here as a fallback
                     logger.warn('[Accumulator] Stream ended during thinking state. Finalizing thinking message.');
                      completedMessage = {
                         role: 'assistant_thinking',
                         content: this.currentContent,
                         createdAt: new Date()
                     };
                }
                // Reset state after finalizing
                this.resetState(); 
                break;
            
            case 'error':
                // Log error, potentially clear state?
                logger.error('[Accumulator] Received error chunk:', chunk.error);
                // Reset state on error to prevent inconsistent messages
                this.resetState();
                break;
        }

        // Add the completed message (if any) to the list *once* at the end
        if (completedMessage) {
            this.allCompletedMessages.push(completedMessage);
        }

        return completedMessage;
    }

    /**
     * Returns a copy of all messages completed by the accumulator so far.
     */
    getCompletedMessages(): Message[] {
        return [...this.allCompletedMessages]; // Return a copy
    }

    /**
     * Resets the internal state for building the next message.
     */
    private resetState(nextRole: 'assistant' | 'assistant_thinking' | null = null): void {
        this.currentRole = nextRole;
        this.currentContent = "";
        // Keep completedToolCalls until stream_end finalizes them
        // Keep currentToolCalls until they are completed by tool_use_end
        if (nextRole === null) { // Only fully reset maps/arrays/message list when finishing a cycle
             this.currentToolCalls.clear();
             this.completedToolCalls = [];
        }
    }
} 