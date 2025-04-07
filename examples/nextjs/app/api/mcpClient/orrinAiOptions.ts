import { SQLiteDatabaseAdapter } from "@orrin-ai/database-adapter-sqlite";
import { ClaudeAdapter } from "@orrin-ai/llm-adapters-anthropic";
import { NextOrrinAiOptions } from "@orrin-ai/nextjs";
import path from 'path';

// Use SQLite database adapter with a file in the .next/cache directory
const dbPath = path.join(process.cwd(), '.next/cache/orrin-ai-sessions.db');
const dbAdapter = new SQLiteDatabaseAdapter({ dbPath });

const mcpServers = ["http://localhost:3000/sse"]

// Use the real ClaudeAdapter - ensure ANTHROPIC_API_KEY is set in your environment!
const llmAdapter = new ClaudeAdapter({
  apiKey: process.env.ANTHROPIC_API_KEY,
}); 

export default NextOrrinAiOptions({
    databaseAdapter: dbAdapter,
    llmAdapter: llmAdapter, // Use the ClaudeAdapter instance
    mcpServerUrls: mcpServers.length > 0 ? mcpServers : undefined,
});