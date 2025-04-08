# Orrin AI CLI Example

A command-line interface example showcasing the Orrin AI framework.

## Prerequisites

- Node.js 18+ installed
- An Anthropic API key (Claude access)

## Setup

1. Clone the repository (if you haven't already)

2. Install dependencies:
```bash
cd examples/cli
npm install
```

3. Set up your environment variables:
```bash
# Linux/macOS
export ANTHROPIC_API_KEY=your_api_key_here

# Windows (Command Prompt)
set ANTHROPIC_API_KEY=your_api_key_here

# Windows (PowerShell)
$env:ANTHROPIC_API_KEY="your_api_key_here"
```

## Running the Example

Start the CLI tool:
```bash
npm start
```

This will launch an interactive command-line interface where you can:
1. Enter messages to chat with the AI
2. See streaming responses in real-time
3. Observe tool usage and thinking state

## Example Usage

Once the CLI is running:

```
OrrinAI Client Simple Test CLI (Streaming)
-------------------------------------------
Ensure ANTHROPIC_API_KEY environment variable is set.
Enter your messages below (type 'quit' or 'exit' to stop).
---

> Hello, what can you help me with today?
Assistant: I can help you with a wide range of tasks, including answering questions, providing information, brainstorming ideas, drafting content, and more. I'm designed to be helpful, harmless, and honest in my responses. Feel free to ask me anything!
---

> What's the current time?
Assistant: I don't have access to real-time information like the current time. I'm an AI system that works with the information provided to me, but I don't have the ability to check the current time, date, weather, or other real-time data unless it's provided through a tool or in the conversation.
---

> exit
```

To exit the CLI, type `quit` or `exit`.

## How It Works

This example demonstrates:

1. Setting up the ClaudeAdapter for LLM integration
2. Using SQLiteDatabaseAdapter for persistent storage
3. Creating and managing a session
4. Streaming responses with proper formatting
5. Displaying thinking state and tool usage

The core implementation is in `src/run.ts`, which shows how to properly initialize the client, handle user input, and process streaming responses. 