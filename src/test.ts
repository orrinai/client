import readline from 'readline/promises';
import { OrrinAiClient } from './index.js'; // Adjust path if needed, added .js extension
import type { LLMAdapter, DatabaseAdapter, Message, LLMTool, LLMCompletionChunk } from './index.js'; // Import interfaces, added .js extension
// Import the real ClaudeAdapter
import { ClaudeAdapter } from './llm-adapters/claude-adapter.js';
import { InMemoryDatabaseAdapter } from './in-memory-database-adapter.js';
import { logger, LogLevel } from './utils/logger.js'; // Import logger and LogLevel
// Import the accumulator
import { MessageAccumulator } from './utils/message-accumulator.js'; 

// --- Main Test Script Logic ---

async function main() {
    // logger.setLevel(LogLevel.DEBUG); // Use DEBUG for verbose stream logging
    logger.setLevel(LogLevel.WARN); // Keep default less verbose

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const dbAdapter = new InMemoryDatabaseAdapter();

    const mcpServers = ["http://localhost:3000/sse"]

    // Use the real ClaudeAdapter - ensure ANTHROPIC_API_KEY is set in your environment!
    const llmAdapter = new ClaudeAdapter(); 
    const client = new OrrinAiClient({
        databaseAdapter: dbAdapter,
        llmAdapter: llmAdapter, // Use the ClaudeAdapter instance
        mcpServerUrls: mcpServers.length > 0 ? mcpServers : undefined,
    });

    // Keep console.log for user-facing messages
    console.log("\nOrrinAI Client Simple Test CLI (Streaming)");
    console.log("-------------------------------------------");
    console.log("Ensure ANTHROPIC_API_KEY environment variable is set.");
    if (mcpServers.length > 0) {
        console.log(`Attempting to use MCP Servers: ${mcpServers.join(', ')}`);
    }

    let sessionId: string | null = null; // Keep track of session ID for cleanup
    try {
        logger.info("Creating initial session..."); // Use logger
        sessionId = await client.createSession();
        logger.info(`Session created: ${sessionId}`); // Use logger
        console.log("Enter your messages below (type 'quit' or 'exit' to stop).");
        console.log("---");

        while (true) {
            const userInput = await rl.question("> ");
            const inputLower = userInput.trim().toLowerCase();

            if (inputLower === 'quit' || inputLower === 'exit') {
                logger.info("Exit command received."); // Use logger
                break;
            }

            if (!userInput.trim()) {
                continue;
            }

            // --- State for Display Logic --- 
            let firstTextChunk = true; 
            let inTextStream = false; 
            let inThinkingStream = false;
            let thinkingChunkCount = 0;
            const toolIdToNameMap: Map<string, string> = new Map();
            const accumulator = new MessageAccumulator(); // For local message composition if needed

            try {
                logger.info(`Sending message for session ${sessionId}:`, userInput);
                
                // Iterate through the stream from addUserMessage
                for await (const item of client.addUserMessage(sessionId, userInput)) {
                    
                    // Check if it's a raw chunk or a composed message
                    if ('type' in item) { // It's an LLMCompletionChunk
                        const chunk = item;
                        accumulator.addChunk(chunk); // Feed accumulator (might be useful later)

                        // --- Handle Chunk Display --- 
                        switch (chunk.type) {
                            case 'text_start':
                                // If thinking was just happening, end its line
                                if (inThinkingStream) {
                                    process.stdout.write('\n');
                                    inThinkingStream = false;
                                }
                                inTextStream = true;
                                firstTextChunk = true;
                                break;
                            case 'text_delta':
                                if (firstTextChunk) {
                                    process.stdout.write('Assistant: ');
                                    firstTextChunk = false;
                                }
                                process.stdout.write(chunk.delta);
                                break;
                            case 'text_end':
                                // Handled by stream_end or next content block start
                                break; 
                            case 'thinking_start':
                                // If text was streaming, end its line
                                if (inTextStream) {
                                    process.stdout.write('\n');
                                    inTextStream = false;
                                    firstTextChunk = true; // Reset for next potential text
                                }
                                if (!inThinkingStream) {
                                     process.stdout.write('Thinking: ');
                                     inThinkingStream = true;
                                     thinkingChunkCount = 0;
                                }
                                break;
                            case 'thinking_delta':
                                thinkingChunkCount++;
                                if (thinkingChunkCount % 10 === 0) {
                                    process.stdout.write('.');
                                }
                                break;
                            case 'thinking_end':
                                // Handled by stream_end or next content block start
                                break;
                            case 'tool_use_start':
                                 // If text or thinking was streaming, end its line
                                 if (inTextStream || inThinkingStream) {
                                    process.stdout.write('\n');
                                    inTextStream = false;
                                    inThinkingStream = false;
                                    firstTextChunk = true;
                                }
                                toolIdToNameMap.set(chunk.id, chunk.name); // Store name for later
                                console.log(`Calling tool: "${chunk.name}"...`); // Use console.log for newline
                                break;
                            // Ignore other chunk types for display (tool_use_delta/end, stream_start/end, error)
                            case 'stream_end':
                                // Final cleanup for display states
                                if (inTextStream || inThinkingStream) {
                                    process.stdout.write('\n'); 
                                }
                                inTextStream = false;
                                inThinkingStream = false;
                                firstTextChunk = true;
                                break;
                             case 'error':
                                 if (inTextStream || inThinkingStream) process.stdout.write('\n');
                                 console.error('\n[STREAM ERROR]');
                                 inTextStream = false;
                                 inThinkingStream = false;
                                 firstTextChunk = true;
                                 break;
                        } 

                    } else if ('role' in item) { // It's a Message
                         const message = item;
                         // Agent now only yields tool_result messages
                         if (message.role === 'tool_result' && message.tool_result) {
                             // If text or thinking was streaming, end its line
                             if (inTextStream || inThinkingStream) {
                                process.stdout.write('\n');
                                inTextStream = false;
                                inThinkingStream = false;
                                firstTextChunk = true;
                            }
                             const toolName = toolIdToNameMap.get(message.tool_result.tool_call_id) ?? message.tool_result.tool_call_id;
                             const status = message.tool_result.is_error ? '(Error)' : '';
                             // Use the message content which should now hold the result string
                             console.log(`Tool call ${toolName} done`);
                         }
                    }
                }
                // Loop finished, final display state handled by stream_end or error chunk

            } catch (error) {
                // Ensure newline if error occurs mid-stream display
                if (inTextStream || inThinkingStream) process.stdout.write('\n'); 
                logger.error("Error processing message:", error);
                console.error("\nAn error occurred. Please check the logs.");
                 // Reset display state on error too
                 inTextStream = false;
                 inThinkingStream = false;
                 firstTextChunk = true;
            }
             console.log("---"); // Keep user-facing separator
        }
    } catch (error) {
         logger.error("Critical error during initialization or session creation:", error); // Use logger
         console.error("\nA critical error occurred. Please check the logs."); // Keep user-facing
    } finally {
        // Ensure the created session is closed
        if (sessionId) {
             logger.info(`Closing session ${sessionId}...`);
             await client.closeSession(sessionId).catch(err => logger.error(`Error closing session ${sessionId} on exit:`, err));
        }
        // Optional: Disconnect all remaining agents if the test script managed multiple sessions
        // await client.disconnectAll();
        rl.close();
    }
}

main().catch(error => {
    logger.error("Unhandled error in main function:", error); // Use logger
    console.error("\nAn unhandled error occurred. Please check the logs and restart."); // Keep user-facing
    process.exit(1);
}); 