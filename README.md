# Orrin AI Client (`orrinai/client`)

The `orrinai/client` is a fully spec-compliant, open-source [MCP (Multi-party Computation Protocol - assuming this is the meaning, please clarify if not)](link-to-mcp-spec-if-available) client implementation provided as an npm package. It allows you to easily set up a server that handles MCP sessions and messages.

## Features

*   **MCP Compliant:** Adheres to the MCP specification.
*   **Simple Setup:** Get a running MCP client server with a single function call.
*   **Extensible:** Supports different LLM connectors and database adapters.
*   **Open Source:** Contribute and customize as needed.

## Installation

Install the package using npm or yarn:

```bash
npm install @orrinai/client
# or
yarn add @orrinai/client
```

You will also need to install a desired LLM connector and optionally a database adapter. For example, to use the base LLM connector:

```bash
npm install @orrinai/connector-llm # Replace with the actual connector package name
# or
yarn add @orrinai/connector-llm   # Replace with the actual connector package name
```

*(Note: Please replace `@orrinai/connector-llm` with the actual name of your base connector package)*

## Quick Start

Using the client is straightforward. Import the package and call the `run` function.

```javascript
// index.js
import { run } from '@orrinai/client';
import { BaseLLMConnector } from '@orrinai/connector-llm'; // Replace with actual import

// Instantiate your desired LLM Connector
const llmConnector = new BaseLLMConnector(/* options */);

// Optional: Instantiate a database adapter if you don't want the default in-memory store
// import { SomeDatabaseAdapter } from '@orrinai/db-adapter-some'; // Example
// const dbAdapter = new SomeDatabaseAdapter(/* connection details */);

async function startServer() {
  try {
    // Start the server, optionally passing a database adapter
    const serverInstance = await run({
      // databaseAdapter: dbAdapter, // Uncomment if using a custom adapter
      port: 3000 // Optional: specify a port, defaults might apply
    });

    console.log(`MCP Client server running on port ${serverInstance.port}`); // Adjust based on actual return value

    // The server is now running and listening for requests.
  } catch (error) {
    console.error("Failed to start MCP client server:", error);
    process.exit(1);
  }
}

startServer();

```

## Server Endpoints

Calling `run()` boots up a server (typically an HTTP server, e.g., Express) that exposes the following endpoints:

1.  **`POST /session`**: Creates a new MCP session.
    *   **Request Body:** (Define the expected request body for creating a session)
    *   **Response:** (Define the expected response, e.g., session ID)

2.  **`POST /session/:sessionId/message`**: Adds a message to an existing MCP session.
    *   **Parameters:**
        *   `sessionId`: The ID of the session to add the message to.
    *   **Request Body:**
        *   Includes the message content.
        *   **Requires an `llmConnector` instance to be provided contextually or configured globally.** *(Clarification needed: How is the connector provided for this endpoint call? Is it configured once during `run`, or passed with each request? The draft assumes it's configured during `run` or globally, adjust if needed)*.
    *   **Response:** (Define the expected response)

## Configuration

### LLM Connectors

When adding a message (`addMessage` endpoint), the client needs an **LLM Connector** to process the message. Connectors handle the communication with the specific Large Language Model (LLM) service.

You **must** provide an instantiated LLM connector. Available connectors can be found in the `@orrinai/connectors` namespace (or specify the actual location).

*(Example: Link to connector documentation or repository)*

### Database Adapters

By default, the client uses an in-memory database for storing session and message data. This means all data will be lost when the server restarts.

For persistent storage, you can optionally pass a **Database Adapter** instance to the `run` function.

```javascript
import { run } from '@orrinai/client';
import { PostgresAdapter } from '@orrinai/db-adapter-postgres'; // Example adapter

const dbAdapter = new PostgresAdapter({ connectionString: 'your-db-connection-string' });

run({ databaseAdapter: dbAdapter });
```

Available database adapters can be found in the `@orrinai/db-adapters` namespace (or specify the actual location).

*(Example: Link to adapter documentation or repository)*

## Setting up a Hosted MCP Client

To run this client persistently (a "Hosted MCP Client"), you need to deploy the Node.js application (like the `index.js` example above) to a server environment.

Common options include:

1.  **Platform as a Service (PaaS):** Services like Vercel, Netlify (for serverless functions), Heroku, Render, or Google Cloud Run abstract away server management.
    *   Configure your `package.json` with a start script:
        ```json
        // package.json
        {
          "scripts": {
            "start": "node index.js"
          }
        }
        ```
    *   Deploy your code repository to the PaaS provider. They will typically build and run your `start` script.
    *   Ensure any required environment variables (like database connection strings or API keys for LLM connectors) are configured in the PaaS environment settings.

2.  **Virtual Private Server (VPS) / Cloud VM:** Services like AWS EC2, Google Compute Engine, DigitalOcean Droplets give you full server control.
    *   Set up Node.js and npm/yarn on the server.
    *   Copy your project code to the server.
    *   Install dependencies: `npm install --production`
    *   Run the application using a process manager like `pm2` to ensure it runs in the background and restarts automatically if it crashes:
        ```bash
        npm install pm2 -g
        pm2 start index.js --name mcp-client
        pm2 startup # To ensure pm2 restarts on server reboot
        pm2 save
        ```
    *   Configure environment variables (e.g., using a `.env` file and `dotenv` package, or system environment variables).
    *   Set up a reverse proxy (like Nginx or Caddy) to handle incoming HTTP requests, manage SSL certificates, and forward traffic to your Node.js application running on `localhost:3000` (or your chosen port).

3.  **Containerization (Docker):** Package your application into a Docker container.
    *   Create a `Dockerfile`.
    *   Build the Docker image.
    *   Run the container on a container orchestration platform (like Kubernetes, Docker Swarm) or directly on a server with Docker installed.
    *   Manage environment variables through the container platform's mechanisms.

**Key Considerations for Hosting:**

*   **Environment Variables:** Securely manage API keys, database credentials, and other sensitive configuration. **Do not commit secrets directly into your code.**
*   **Process Management:** Ensure your server process runs reliably and restarts if it fails (using tools like `pm2`, or features of your PaaS/container platform).
*   **Logging:** Configure proper logging to monitor the application and diagnose issues.
*   **Security:** Secure your server environment, manage firewall rules, and consider rate limiting or authentication for the API endpoints if necessary.
*   **Database:** If using a persistent database adapter, ensure the database server is running, accessible, and properly secured.

## Contributing

(Add guidelines for contributing if applicable)

## License

(Specify the license, e.g., MIT, Apache 2.0) 