import { randomUUID } from 'crypto';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LLMTool } from '../types.js'; // Added .js extension
import { logger } from '../utils/logger.js'; // Added .js extension

interface MCPRouterConfig {
    transports: Transport[];
}

// Interface to hold client instance and its originating transport's index
interface ClientInfo {
    client: MCPClient;
    transportIndex: number; // Store index instead of URL
}

/**
 * Manages connections to multiple MCP Servers via provided Transports,
 * aggregates their tools, and routes tool calls to the appropriate server.
 */
export class MCPRouter {
    private transports: Transport[]; // Store Transport objects
    private activeClientsInfo: ClientInfo[] = [];
    private aggregatedTools: LLMTool[] = [];
    private toolClientMap: Map<string, ClientInfo> = new Map();
    private isConnected: boolean = false;

    constructor(config: MCPRouterConfig) {
        if (!config || !config.transports) {
            throw new Error('MCPRouter requires a configuration object with transports.');
        }
        this.transports = config.transports; // Store provided transports
    }

    /**
     * Connects using all configured MCP transports in parallel, lists their tools,
     * and aggregates them.
     * @throws {Error} If connection fails and needs to be handled.
     */
    async connect(): Promise<void> {
        if (this.isConnected) {
            logger.warn("MCPRouter is already connected."); // Warn
            return;
        }
        if (this.transports.length === 0) {
            logger.info("No MCP transports configured for MCPRouter."); // Info
            this.isConnected = true; // Technically connected to nothing
            return;
        }

        logger.info(`MCPRouter: Attempting to connect via ${this.transports.length} MCP transport(s)...`); // Info

        // Reset state before connecting
        this.activeClientsInfo = [];
        this.aggregatedTools = [];
        this.toolClientMap = new Map();

        const connectionPromises = this.transports.map(async (transport, index) => {
            const clientName = `mcp-router-client-${randomUUID().substring(0, 8)}`;
            const mcpClient = new MCPClient({ name: clientName, version: '0.1.0' });
            // Use index for identification
            const clientInfo: ClientInfo = { client: mcpClient, transportIndex: index };
            let addedToActiveList = false;
            const transportIdentifier = `transport[${index}]` + (transport.sessionId ? ` (Session: ${transport.sessionId})` : '');

            try {
                // Connect using the provided transport
                await mcpClient.connect(transport);
                logger.info(`MCPRouter: Successfully connected via ${transportIdentifier}`); // Info
                this.activeClientsInfo.push(clientInfo);
                addedToActiveList = true;

                const toolsResult = await mcpClient.listTools();
                const serverTools = toolsResult.tools.map((tool): LLMTool => ({
                    name: tool.name,
                    description: tool.description || 'No description provided.',
                    input_schema: tool.inputSchema as Record<string, any>,
                }));
                logger.info(`MCPRouter: Found ${serverTools.length} tools via ${transportIdentifier}:`, serverTools.map(t => t.name || '{No Name}')); // Info

                // Map each tool name to this client instance's info
                serverTools.forEach(tool => {
                    if (tool && tool.name) {
                        if (this.toolClientMap.has(tool.name)) {
                            const existingClientIndex = this.toolClientMap.get(tool.name)?.transportIndex;
                            logger.warn(`MCPRouter: Duplicate tool name '${tool.name}' detected. Provided by ${transportIdentifier}, but already mapped by transport[${existingClientIndex}]. The new transport (${transportIdentifier}) will overwrite the old one for this tool.`); // Warn
                        }
                        this.toolClientMap.set(tool.name, clientInfo);
                    } else {
                        logger.warn(`MCPRouter: Found a tool without a name via ${transportIdentifier}. Skipping.`); // Warn
                    }
                });
                return serverTools;

            } catch (mcpError) {
                logger.error(`MCPRouter: Failed to connect or get tools via ${transportIdentifier}:`, mcpError); // Error
                if (addedToActiveList) {
                    const clientIndex = this.activeClientsInfo.findIndex(info => info.client === mcpClient);
                    if (clientIndex > -1) {
                        this.activeClientsInfo.splice(clientIndex, 1);
                    }
                }
                await mcpClient.close().catch(closeErr => { /* ignore close error */ });
                return [];
            }
        });

        const results = await Promise.allSettled(connectionPromises);

        const allTools = results
            .filter((result): result is PromiseFulfilledResult<LLMTool[]> => result.status === 'fulfilled' && Array.isArray(result.value))
            .flatMap(result => result.value);

        const uniqueToolNames = new Set<string>();
        this.aggregatedTools = allTools.filter(tool => {
            if (tool && typeof tool.name === 'string' && !uniqueToolNames.has(tool.name)) {
                uniqueToolNames.add(tool.name);
                return true;
            }
            return false;
        });

        this.isConnected = true;
        logger.info(`MCPRouter: Aggregated ${this.aggregatedTools.length} unique tools from ${this.activeClientsInfo.length} connected transport(s):`, this.aggregatedTools.map(t => t.name || '{No Name}')); // Info

        const failedConnections = results.filter(result => result.status === 'rejected');
        if (failedConnections.length > 0) {
            logger.error(`MCPRouter: Failed to connect via ${failedConnections.length} transport(s).`); // Error
            // Potentially throw error
        }
        if (this.activeClientsInfo.length === 0 && this.transports.length > 0) {
            logger.error(`MCPRouter: Failed to connect via ALL configured transports (${this.transports.length}).`); // Error
            // Throw error to signal complete connection failure
            throw new Error(`MCPRouter: Failed to connect via ALL configured transports (${this.transports.length}).`);
        }
    }

    /**
     * Checks if the router has successfully connected via at least one transport.
     * @returns {boolean} True if connected, false otherwise.
     */
    getIsConnected(): boolean {
        return this.isConnected && this.activeClientsInfo.length > 0;
    }

    /**
     * Returns the aggregated list of unique tools available across all connected transports.
     * Requires `connect()` to have been called successfully first.
     * @returns {LLMTool[]} An array of unique tools.
     */
    listTools(): LLMTool[] {
        if (!this.getIsConnected()) {
            logger.warn("MCPRouter: Cannot list tools before connecting via at least one transport."); // Warn
            return [];
        }
        return [...this.aggregatedTools];
    }

    /**
     * Calls a specific tool by name. It finds the responsible MCP client
     * and forwards the call.
     * Requires `connect()` to have been called successfully first.
     * @param params - The parameters for the tool call, including name and arguments.
     * @returns The result of the tool call.
     * @throws {Error} If the router is not connected, the tool is not found, or the call fails.
     */
    async callTool(params: CallToolRequest['params']): Promise<CallToolResult> {
        if (!this.getIsConnected()) {
            logger.error("MCPRouter is not connected. Cannot call tool."); // Error
            throw new Error("MCPRouter is not connected. Cannot call tool.");
        }

        const { name, arguments: args } = params;
        logger.info(`MCPRouter: Attempting to call tool '${name}' with args:`, JSON.stringify(args)); // Info

        const clientInfo = this.toolClientMap.get(name);

        if (!clientInfo) {
            logger.error(`MCPRouter: Tool '${name}' not found among aggregated tools or its provider is unavailable.`); // Error
            throw new Error(`Tool '${name}' not found or unavailable.`);
        }

        const { client, transportIndex } = clientInfo; // Get client and index
        const transportIdentifier = `transport[${transportIndex}]`;

        try {
            const result = await client.callTool({ name, arguments: args });
            logger.info(`MCPRouter: Tool '${name}' executed successfully via ${transportIdentifier}.`); // Info
            return result as CallToolResult;
        } catch (error) {
            logger.error(`MCPRouter: Error executing tool '${name}' via ${transportIdentifier}:`, error); // Error
            throw new Error(`Failed to execute tool '${name}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Closes connections for all active MCP clients.
     */
    async close(): Promise<void> {
        if (this.activeClientsInfo.length === 0) {
            logger.info("MCPRouter: No active connections to close."); // Info
            if (this.isConnected && this.transports.length === 0) {
                 this.isConnected = false;
            }
            return;
        }

        logger.info(`MCPRouter: Closing ${this.activeClientsInfo.length} active MCP client connection(s)...`); // Info
        const closePromises = this.activeClientsInfo.map(({ client, transportIndex }) => {
            const transportIdentifier = `transport[${transportIndex}]`;
            return client.close().catch(err => 
                logger.error(`MCPRouter: Error closing client for ${transportIdentifier}:`, err) // Error
            );
        });

        await Promise.allSettled(closePromises);

        logger.info('MCPRouter: Finished closing MCP client connections.'); // Info
        this.activeClientsInfo = [];
        this.aggregatedTools = [];
        this.toolClientMap = new Map();
        this.isConnected = false;
    }
} 