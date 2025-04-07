import type { DatabaseAdapter, Message, LLMToolCallRequest, LLMToolResult, BaseMessage, ToolResultMessage } from "@orrin-ai/mcp-agent";
import { logger } from "@orrin-ai/mcp-agent";
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

/**
 * An SQLite database adapter for storing session messages.
 * Provides persistent storage for sessions and messages.
 */
export class SQLiteDatabaseAdapter implements DatabaseAdapter {
    private db: Database | null = null;
    private dbPath: string;
    private initialized: boolean = false;

    /**
     * Creates a new SQLiteDatabaseAdapter
     * @param options Configuration options for the SQLite database
     */
    constructor(options: { dbPath?: string } = {}) {
        this.dbPath = options.dbPath || ':memory:';
        logger.info(`[SQLiteDB] Initializing with database at: ${this.dbPath}`);
    }

    /**
     * Initialize the database connection and create necessary tables if they don't exist
     */
    private async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            // Create sessions table
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create messages table
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                )
            `);

            // Create table for message tool calls
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS tool_calls (
                    id TEXT PRIMARY KEY,
                    message_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    arguments TEXT,
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                )
            `);

            // Create table for message tool results
            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS tool_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER NOT NULL,
                    tool_call_id TEXT NOT NULL,
                    content TEXT,
                    is_error BOOLEAN DEFAULT 0,
                    FOREIGN KEY (message_id) REFERENCES messages(id),
                    FOREIGN KEY (tool_call_id) REFERENCES tool_calls(id)
                )
            `);

            this.initialized = true;
            logger.info('[SQLiteDB] Database initialized successfully');
        } catch (error) {
            logger.error('[SQLiteDB] Failed to initialize database:', error);
            throw new Error(`Failed to initialize SQLite database: ${error}`);
        }
    }

    /**
     * Creates a new session in the database
     * @param sessionId - The unique identifier for the session
     */
    async createSession(sessionId: string): Promise<void> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            // Check if session already exists
            const existingSession = await this.db.get(
                'SELECT id FROM sessions WHERE id = ?',
                sessionId
            );

            if (existingSession) {
                logger.warn(`[SQLiteDB] Session ${sessionId} already exists. No action taken.`);
                return;
            }

            // Insert new session
            await this.db.run(
                'INSERT INTO sessions (id) VALUES (?)',
                sessionId
            );

            logger.info(`[SQLiteDB] Created session: ${sessionId}`);
        } catch (error) {
            logger.error(`[SQLiteDB] Error creating session ${sessionId}:`, error);
            throw new Error(`Failed to create session ${sessionId}: ${error}`);
        }
    }

    /**
     * Retrieves session data for the given ID, or null if not found
     * @param sessionId - The ID of the session to retrieve
     * @returns Session data object or null if not found
     */
    async getSession(sessionId: string): Promise<{ id: string } | null> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            const session = await this.db.get(
                'SELECT id FROM sessions WHERE id = ?',
                sessionId
            );

            if (session) {
                logger.info(`[SQLiteDB] Session ${sessionId} found`);
                return { id: session.id };
            }

            logger.info(`[SQLiteDB] Session ${sessionId} not found`);
            return null;
        } catch (error) {
            logger.error(`[SQLiteDB] Error retrieving session ${sessionId}:`, error);
            throw new Error(`Failed to retrieve session ${sessionId}: ${error}`);
        }
    }

    /**
     * Adds a message to a specific session
     * @param sessionId - The ID of the session
     * @param message - The message object to add
     * @throws {Error} If the session does not exist
     */
    async addMessage(sessionId: string, message: Message): Promise<void> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            // Check if session exists
            const session = await this.getSession(sessionId);
            if (!session) {
                logger.error(`[SQLiteDB] Attempted to add message to non-existent session: ${sessionId}`);
                throw new Error(`Session with ID ${sessionId} does not exist.`);
            }

            // Begin transaction
            await this.db.run('BEGIN TRANSACTION');

            // Insert message
            const result = await this.db.run(
                'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
                sessionId,
                message.role,
                message.content || null
            );

            const messageId = result.lastID;

            // Handle tool calls for BaseMessage type
            if (message.role === 'tool_use' && 'tool_calls' in message && message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    await this.db.run(
                        'INSERT INTO tool_calls (id, message_id, name, arguments) VALUES (?, ?, ?, ?)',
                        toolCall.id,
                        messageId,
                        toolCall.name,
                        JSON.stringify(toolCall.input)
                    );
                }
            }

            // Handle tool results for ToolResultMessage type
            if (message.role === 'tool_result' && 'tool_results' in message && message.tool_results && message.tool_results.length > 0) {
                for (const toolResult of message.tool_results) {
                    let content: string | null = null;
                    
                    if (typeof toolResult.content === 'string') {
                        content = toolResult.content;
                    } else if (toolResult.content) {
                        content = JSON.stringify(toolResult.content);
                    }
                    
                    await this.db.run(
                        'INSERT INTO tool_results (message_id, tool_call_id, content, is_error) VALUES (?, ?, ?, ?)',
                        messageId,
                        toolResult.tool_call_id,
                        content,
                        toolResult.is_error ? 1 : 0
                    );
                }
            }

            // Commit transaction
            await this.db.run('COMMIT');

            // Log added message summary
            const contentSummary = message.content ? message.content.substring(0, 50) + '...' : '(No Content)';
            logger.info(`[SQLiteDB] Added message to session ${sessionId}: ${message.role} ${contentSummary}`);
        } catch (error) {
            // Rollback transaction on error
            if (this.db) {
                await this.db.run('ROLLBACK').catch((err: Error) => {
                    logger.error('[SQLiteDB] Error rolling back transaction:', err);
                });
            }

            logger.error(`[SQLiteDB] Error adding message to session ${sessionId}:`, error);
            throw new Error(`Failed to add message to session ${sessionId}: ${error}`);
        }
    }

    /**
     * Retrieves all messages for a specific session
     * @param sessionId - The ID of the session
     * @returns An array of messages ordered by creation time
     * @throws {Error} If the session does not exist
     */
    async getMessages(sessionId: string): Promise<Message[]> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            // Check if session exists
            const session = await this.getSession(sessionId);
            if (!session) {
                logger.error(`[SQLiteDB] Attempted to get messages from non-existent session: ${sessionId}`);
                throw new Error(`Session with ID ${sessionId} does not exist.`);
            }

            // Get all messages for the session
            const messages = await this.db.all(
                'SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY created_at',
                sessionId
            );

            const result: Message[] = [];

            // For each message, fetch associated tool calls and results
            for (const msg of messages) {
                // Create base message structure
                if (msg.role === 'tool_result') {
                    // For tool result messages
                    const toolResults = await this.db.all(
                        'SELECT tool_call_id, content, is_error FROM tool_results WHERE message_id = ?',
                        msg.id
                    );

                    if (toolResults.length > 0) {
                        const toolResultsData: LLMToolResult[] = toolResults.map((tr: any) => ({
                            tool_call_id: tr.tool_call_id,
                            content: tr.content && tr.content.startsWith('{') ? 
                                JSON.parse(tr.content) : tr.content,
                            is_error: Boolean(tr.is_error)
                        }));

                        const message: ToolResultMessage = {
                            role: 'tool_result',
                            tool_results: toolResultsData,
                            content: null
                        };

                        result.push(message);
                    }
                } else {
                    // For other message types (user, assistant, assistant_thinking, tool_use)
                    const baseMessage: BaseMessage = {
                        role: msg.role as 'user' | 'assistant' | 'assistant_thinking' | 'tool_use',
                        content: msg.content
                    };

                    // Add tool calls if this is a tool_use message
                    if (msg.role === 'tool_use') {
                        const toolCalls = await this.db.all(
                            'SELECT id, name, arguments FROM tool_calls WHERE message_id = ?',
                            msg.id
                        );

                        if (toolCalls.length > 0) {
                            baseMessage.tool_calls = toolCalls.map((tc: any) => ({
                                id: tc.id,
                                name: tc.name,
                                input: tc.arguments ? JSON.parse(tc.arguments) : {}
                            }));
                        }
                    }

                    result.push(baseMessage);
                }
            }

            logger.info(`[SQLiteDB] Retrieved ${result.length} messages for session ${sessionId}`);
            return result;
        } catch (error) {
            logger.error(`[SQLiteDB] Error retrieving messages for session ${sessionId}:`, error);
            throw new Error(`Failed to retrieve messages for session ${sessionId}: ${error}`);
        }
    }

    /**
     * Closes the database connection
     */
    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
            this.initialized = false;
            logger.info('[SQLiteDB] Database connection closed');
        }
    }

    /**
     * Deletes a session and all its messages
     * @param sessionId - The ID of the session to delete
     */
    async deleteSession(sessionId: string): Promise<void> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            // Check if session exists
            const session = await this.getSession(sessionId);
            if (!session) {
                logger.warn(`[SQLiteDB] Attempted to delete non-existent session: ${sessionId}`);
                return;
            }

            // Begin transaction
            await this.db.run('BEGIN TRANSACTION');

            // Get all message IDs for the session
            const messageIds = await this.db.all(
                'SELECT id FROM messages WHERE session_id = ?',
                sessionId
            );

            // For each message, delete associated tool calls and results
            for (const { id } of messageIds) {
                await this.db.run('DELETE FROM tool_calls WHERE message_id = ?', id);
                await this.db.run('DELETE FROM tool_results WHERE message_id = ?', id);
            }

            // Delete all messages for the session
            await this.db.run(
                'DELETE FROM messages WHERE session_id = ?',
                sessionId
            );

            // Delete the session
            await this.db.run(
                'DELETE FROM sessions WHERE id = ?',
                sessionId
            );

            // Commit transaction
            await this.db.run('COMMIT');

            logger.info(`[SQLiteDB] Deleted session ${sessionId} and all associated data`);
        } catch (error) {
            // Rollback transaction on error
            if (this.db) {
                await this.db.run('ROLLBACK').catch((err: Error) => {
                    logger.error('[SQLiteDB] Error rolling back transaction:', err);
                });
            }

            logger.error(`[SQLiteDB] Error deleting session ${sessionId}:`, error);
            throw new Error(`Failed to delete session ${sessionId}: ${error}`);
        }
    }

    /**
     * Clears all sessions and messages from the database
     */
    async clearAllSessions(): Promise<void> {
        await this.initialize();
        if (!this.db) throw new Error('Database not initialized');

        try {
            // Begin transaction
            await this.db.run('BEGIN TRANSACTION');

            // Delete all data
            await this.db.run('DELETE FROM tool_results');
            await this.db.run('DELETE FROM tool_calls');
            await this.db.run('DELETE FROM messages');
            await this.db.run('DELETE FROM sessions');

            // Commit transaction
            await this.db.run('COMMIT');

            logger.info('[SQLiteDB] All sessions cleared');
        } catch (error) {
            // Rollback transaction on error
            if (this.db) {
                await this.db.run('ROLLBACK').catch((err: Error) => {
                    logger.error('[SQLiteDB] Error rolling back transaction:', err);
                });
            }

            logger.error('[SQLiteDB] Error clearing all sessions:', error);
            throw new Error(`Failed to clear all sessions: ${error}`);
        }
    }
} 