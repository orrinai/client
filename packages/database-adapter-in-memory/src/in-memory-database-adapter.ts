import type { DatabaseAdapter, Message } from "@orrin-ai/mcp-agent"; // Assuming index.js is in the same directory
import { logger } from "@orrin-ai/mcp-agent"; // Import logger
/**
 * A simple in-memory database adapter for storing session messages.
 * Useful for testing or simple deployments without a persistent database.
 */
export class InMemoryDatabaseAdapter implements DatabaseAdapter {
    private sessions: Map<string, Message[]> = new Map();

    /**
     * Creates (initializes) a new session if it doesn't exist.
     * @param sessionId - The unique identifier for the session.
     */
    async createSession(sessionId: string): Promise<void> {
        if (this.sessions.has(sessionId)) {
            logger.warn(`[MockDB] Session ${sessionId} already exists. No action taken.`); // Use logger
        } else {
            this.sessions.set(sessionId, []);
            logger.info(`[MockDB] Creating session: ${sessionId}`); // Use logger
        }
        // No return value needed, resolves promise implicitly
    }

    /**
     * Retrieves session data for the given ID, or null if not found.
     * @param sessionId - The ID of the session to retrieve
     * @returns Session data object or null if not found
     */
    async getSession(sessionId: string): Promise<{id: string} | null> {
        if (this.sessions.has(sessionId)) {
            logger.info(`[MockDB] Session ${sessionId} found`);
            return { id: sessionId };
        }
        logger.info(`[MockDB] Session ${sessionId} not found`);
        return null;
    }

    /**
     * Adds a message to a specific session.
     * @param sessionId - The ID of the session.
     * @param message - The message object to add.
     * @throws {Error} If the session does not exist.
     */
    async addMessage(sessionId: string, message: Message): Promise<void> {
        const sessionMessages = this.sessions.get(sessionId);
        if (!sessionMessages) {
            logger.error(`[MockDB] Attempted to add message to non-existent session: ${sessionId}`); // Use logger
            throw new Error(`Session with ID ${sessionId} does not exist.`);
        }
        sessionMessages.push(message);
         // Log added message summary (handle null content)
         const contentSummary = message.content ? message.content.substring(0, 50) + '...' : '(No Content)';
         logger.info(`[MockDB] Adding message to session ${sessionId}: ${message.role} ${contentSummary}`); // Use logger
        // Resolve promise implicitly
    }

    /**
     * Retrieves all messages for a specific session.
     * @param sessionId - The ID of the session.
     * @returns An array of messages ordered by insertion time.
     * @throws {Error} If the session does not exist.
     */
    async getMessages(sessionId: string): Promise<Message[]> {
        const sessionMessages = this.sessions.get(sessionId);
        if (!sessionMessages) {
            logger.error(`[MockDB] Attempted to get messages from non-existent session: ${sessionId}`); // Use logger
            throw new Error(`Session with ID ${sessionId} does not exist.`);
        }
        logger.info(`[MockDB] Getting messages for session ${sessionId}`); // Use logger
        // Return a copy to prevent external modification of the internal array
        return [...sessionMessages];
    }

    // Optional: Method to clear all sessions (for testing/reset)
    clearAllSessions(): void {
        this.sessions.clear();
        logger.info("[MockDB] All sessions cleared."); // Use logger
    }
}