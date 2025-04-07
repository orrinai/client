import { OrrinAiClient, OrrinAiClientConfig, logger } from "@orrin-ai/mcp-agent";
import { NextRequest, NextResponse } from "next/server.js";

export function NextOrrinAiOptions(config: OrrinAiClientConfig) {
    const sessionManager = new OrrinAiClient(config);

    function createSession() {
        return sessionManager.createSession();
    }

    function openSession(sessionId: string) {
        return sessionManager.openSession(sessionId);
    }

    function createAndOpenSession() {
        return sessionManager.createAndOpenSession();
    }

    function closeSession(sessionId: string) {
        return sessionManager.closeSession(sessionId);
    }

    function disconnectAll() {
        return sessionManager.disconnectAll();
    }

    function addUserMessage(sessionId: string, message: string) {
        return sessionManager.addUserMessage(sessionId, message);
    }

    return {
        createSession,
        openSession,
        createAndOpenSession,
        closeSession,
        disconnectAll,
        addUserMessage,
    }
}

function NextOrrinAi(options: ReturnType<typeof NextOrrinAiOptions>) {
    async function POST(req: NextRequest) {
        const body = await req.json();
        const sessionId = body.sessionId;
        await options.openSession(sessionId);
        const message = body.message;

        // Set up Server-Sent Events response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    // Get the generator that yields message chunks
                    const messageGenerator = options.addUserMessage(sessionId, message);
                    
                    // Iterate through each chunk
                    for await (const chunk of messageGenerator) {
                        // Determine event type and create payload
                        let eventType = "unknown";
                        let payload: any;
                        
                        if ('role' in chunk && chunk.role === 'tool_result') {
                            // Handle ToolResultMessage
                            eventType = 'tool_result';
                            
                            // Create a copy of the chunk without the 'role' property for the payload
                            const { ...payloadData } = chunk;
                            payload = payloadData;
                        } else if ('type' in chunk) {
                            // Handle LLMCompletionChunk
                            eventType = chunk.type;
                            
                            // Create a copy of the chunk without the 'type' property for the payload
                            const { type, ...payloadData } = chunk;
                            payload = payloadData;
                        } else {
                            // Log unexpected chunk format
                            logger.error(`[NextOrrinAi] Received chunk with unexpected format:`, chunk);
                        }
                        
                        // Format as SSE with event type and data
                        const sseFormattedChunk = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
                        controller.enqueue(encoder.encode(sseFormattedChunk));
                    }
                    controller.close();
                } catch (error) {
                    logger.error(`[NextOrrinAi] Error processing message stream:`, error);
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`));
                    controller.close();
                } finally {
                    options.closeSession(sessionId);
                }
            }
        });

        // Return the stream with appropriate headers for SSE
        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        });
    }

    return {
        POST,
    }
}

export default NextOrrinAi;
