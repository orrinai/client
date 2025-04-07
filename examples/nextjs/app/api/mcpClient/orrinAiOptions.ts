import { InMemoryDatabaseAdapter } from "../../../../../src/database-adapters/in-memory-database-adapter";
import { ClaudeAdapter } from "../../../../../src/llm-adapters/claude-adapter";
import { NextOrrinAiOptions } from "../../../../../src/hosts/nextjs-host";

const dbAdapter = new InMemoryDatabaseAdapter();

const mcpServers = ["http://localhost:3000/sse"]

// Use the real ClaudeAdapter - ensure ANTHROPIC_API_KEY is set in your environment!
const llmAdapter = new ClaudeAdapter(); 

export default NextOrrinAiOptions({
    databaseAdapter: dbAdapter,
    llmAdapter: llmAdapter, // Use the ClaudeAdapter instance
    mcpServerUrls: mcpServers.length > 0 ? mcpServers : undefined,
});