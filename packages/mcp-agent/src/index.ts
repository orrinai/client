/**
 * Main MCP Agent Package
 * Re-exports all public API components
 */

import { OrrinAiClient } from './mcp-agent.js';
export default OrrinAiClient;

// Re-export main client
export { OrrinAiClient, OrrinAiClientConfig } from './mcp-agent.js';

// Re-export all types
export * from './types.js';

// Re-export agent components
export { Agent } from './agent/agent.js';
export { MCPRouter } from './agent/mcp-router.js';

// Re-export utility components
export { MessageAccumulator } from './utils/message-accumulator.js';
export { logger, LogLevel } from './utils/logger.js'; 