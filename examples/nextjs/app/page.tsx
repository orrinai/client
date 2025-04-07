import orrinAiOptions from "./api/mcpClient/orrinAiOptions";

export default function Home() {
  const sessionId = orrinAiOptions.createSession();
  return (
    <div>
      <h1>Orrin AI</h1>
      <p>Session ID: {sessionId}</p>
    </div>
  );
}
