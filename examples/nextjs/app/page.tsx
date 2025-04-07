import ChatWindow from "./components/ChatWindow";
import orrinAiOptions from "./api/mcpClient/orrinAiOptions";

export default async function Home() {
  // Create session on the server
  const sessionId = await orrinAiOptions.createAndOpenSession();

  return (
    <main className="min-h-screen p-4 flex flex-col">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold">Orrin AI Chat Demo</h1>
      </header>
      
      <ChatWindow sessionId={sessionId} />
    </main>
  );
}
