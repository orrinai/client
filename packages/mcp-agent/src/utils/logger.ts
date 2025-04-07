export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3, // Added debug for more verbosity if needed
}

// Simple configuration object, could be expanded
interface LoggerConfig {
    level?: LogLevel;
    prefix?: string;
}

export class Logger {
    private static instance: Logger;
    private currentLevel: LogLevel = LogLevel.WARN; // Default level
    private prefix: string = '';

    private constructor(config?: LoggerConfig) {
        if (config?.level !== undefined) {
            this.setLevel(config.level);
        }
        if (config?.prefix) {
            this.prefix = config.prefix;
        }
    }

    // Singleton pattern to ensure one logger instance (optional, but common)
    public static getInstance(config?: LoggerConfig): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger(config);
        }
        // Optionally update config if called again
        else if (config) {
             if (config.level !== undefined) Logger.instance.setLevel(config.level);
             if (config.prefix !== undefined) Logger.instance.prefix = config.prefix;
        }
        return Logger.instance;
    }

    public setLevel(level: LogLevel): void {
        this.currentLevel = level;
        this.info(`Log level set to: ${LogLevel[level]}`);
    }

    private formatMessage(level: LogLevel, message: string, ...optionalParams: any[]): string {
        const levelStr = LogLevel[level];
        const timestamp = new Date().toISOString();
        const prefixStr = this.prefix ? `[${this.prefix}] ` : '';
        const mainMessage = `${timestamp} [${levelStr}] ${prefixStr}${message}`;
        
        // Simple handling for additional params
        const paramsStr = optionalParams.map(p => 
            p instanceof Error ? `\n${p.stack || p.toString()}` // Handle Error objects explicitly
            : (typeof p === 'object' && p !== null) ? JSON.stringify(p, null, 2) // Keep original object handling (ensure not null)
            : String(p) // Handle primitives
        ).join('\n'); // Use newline as separator for potentially multi-line stacks

        return paramsStr ? `${mainMessage}\n${paramsStr}` : mainMessage; // Add newline before params
    }

    public error(message: string, ...optionalParams: any[]): void {
        if (this.currentLevel >= LogLevel.ERROR) {
            console.error(this.formatMessage(LogLevel.ERROR, message, ...optionalParams));
        }
    }

    public warn(message: string, ...optionalParams: any[]): void {
        if (this.currentLevel >= LogLevel.WARN) {
            console.warn(this.formatMessage(LogLevel.WARN, message, ...optionalParams));
        }
    }

    public info(message: string, ...optionalParams: any[]): void {
        if (this.currentLevel >= LogLevel.INFO) {
            console.info(this.formatMessage(LogLevel.INFO, message, ...optionalParams));
        }
    }

    public debug(message: string, ...optionalParams: any[]): void {
        if (this.currentLevel >= LogLevel.DEBUG) {
            console.debug(this.formatMessage(LogLevel.DEBUG, message, ...optionalParams));
        }
    }
}

// Export a default instance for easy use
export const logger = Logger.getInstance(); 