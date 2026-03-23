/**
 * Example: Basic chat with streaming + tool calling
 *
 * Usage (with device flow – recommended):
 *   npx tsx examples/chat.ts
 *
 * Usage (with existing token):
 *   GH_COPILOT_TOKEN=ghu_xxxxx npx tsx examples/chat.ts
 */
import {
  CopilotChatClient,
  ChatSession,
  type Tool,
  type ToolHandler,
} from "../src/index.js";

async function main() {
  const client = new CopilotChatClient();

  // Try init with existing token (env, hosts.json), fall back to device flow
  try {
    await client.init();
  } catch {
    console.log("No token found, starting device flow...\n");
    await client.initWithDeviceFlow(
      (codes) => {
        console.log(`Open: ${codes.verificationUri}`);
        console.log(`Enter code: ${codes.userCode}\n`);
        console.log("Waiting for authorization...");
      },
      { persist: true }, 
    );
    console.log("Authenticated & token saved! Next run will skip device flow.\n");
  }

  console.log(`Connected to ${client.getApiEndpoint()}`);

  // 2. List available models
  const models = await client.getModels();
  console.log(
    `${models.length} models available:`,
    models.map((m) => m.id).join(", "),
  );

  // ── Simple streaming example ──────────────────────────────────

  console.log("\n--- Streaming example ---");
  process.stdout.write("Assistant: ");
  for await (const event of client.stream({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: "Say hello in 3 languages, one per line." }],
  })) {
    const text = event.choices[0]?.delta?.content ?? "";
    process.stdout.write(text);
  }
  console.log("\n");

  // ── Session with tool calling ─────────────────────────────────

  console.log("--- Session + Tool calling example ---");

  const weatherTool: Tool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
    },
  };

  const toolHandlers: Record<string, ToolHandler> = {
    get_weather: async (args) => {
      const city = args.city as string;
      // Simulated weather response
      return JSON.stringify({ city, temperature: "22°C", condition: "Sunny" });
    },
  };

  const session = new ChatSession(client, {
    model: "gpt-5-mini",
    systemPrompt: "You are a helpful assistant with access to weather data.",
    tools: [weatherTool],
    toolHandlers,
  });

  // Non-streaming with auto tool loop
  const response = await session.send("What's the weather in Rome?");
  console.log("Assistant:", response);

  // Streaming with the same session (maintains history)
  console.log("\nAssistant (streaming): ");
  for await (const chunk of session.sendStream(
    "And what about Tokyo?",
  )) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  console.log("Conversation history:", session.getMessages().length, "messages");
}

main().catch(console.error);
