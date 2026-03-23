# ghc-isomorphic-adapter

> ⚠️ **Educational project only.** This library is intended for learning and experimentation purposes. It is not affiliated with, endorsed by, or supported by GitHub. Use at your own risk and in compliance with GitHub's Terms of Service.

Minimal, isomorphic TypeScript library for the **GitHub Copilot Chat API**.  
Supports streaming, sessions, tool calling, and automatic token management.

## Install

```bash
npm install ghc-isomorphic-adapter
```

## Quick Start

```ts
import { CopilotChatClient } from "ghc-isomorphic-adapter";

const client = new CopilotChatClient();

// Option 1: Device flow (interactive – recommended for first use)
const ghToken = await client.initWithDeviceFlow((codes) => {
  console.log(`Open ${codes.verificationUri} and enter: ${codes.userCode}`);
});
// Save ghToken for future use (export GH_COPILOT_TOKEN=ghu_...)

// Option 2: Existing token (env, config file, or explicit)
const client2 = new CopilotChatClient({ token: "ghu_..." });
await client2.init();
```

## Authentication

The library handles the full Copilot auth flow:

1. **Resolve a GitHub token** — from explicit `token` option, `GH_COPILOT_TOKEN` env, or `~/.config/github-copilot/hosts.json`
2. **Exchange it** for a short-lived Copilot session token via `api.github.com/copilot_internal/v2/token`
3. **Auto-refresh** the session token before it expires

### Supported token types

| Token | How to get |
|-------|-----------|
| `ghu_...` (OAuth) | Device flow or Copilot editor sign-in |
| `ghp_...` (Classic PAT) | github.com → Settings → Tokens (needs `copilot` scope) |

### Device Flow (recommended)

The token is **automatically persisted** to `~/.config/github-copilot/hosts.json` after the first device flow. Subsequent calls to `init()` will find it there — no need to re-authenticate.

```ts
const client = new CopilotChatClient();

try {
  // Finds token in env, hosts.json, or apps.json
  await client.init();
} catch {
  // First time only — opens browser for GitHub authorization
  await client.initWithDeviceFlow(
    (codes) => {
      console.log(`Open ${codes.verificationUri} and enter: ${codes.userCode}`);
    },
    { persist: true }, // default: true — saves to hosts.json
  );
}

// From now on, client.init() will just work
```

To disable persistence, pass `{ persist: false }`. You can also manage the config manually:

```ts
import { saveTokenToConfig, readTokenFromConfig } from "ghc-isomorphic-adapter";

await saveTokenToConfig("ghu_...");           // write
const token = await readTokenFromConfig();     // read
```

## List Models

```ts
const models = await client.getModels();
console.log(models.map((m) => `${m.id} (${m.vendor})`));
```

## Chat Completion (non-streaming)

```ts
const response = await client.complete({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message?.content);
```

## Streaming

```ts
for await (const event of client.stream({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Explain TypeScript in 3 sentences." }],
})) {
  process.stdout.write(event.choices[0]?.delta?.content ?? "");
}
```

## Sessions

`ChatSession` maintains conversation history and handles tool-call loops automatically:

```ts
import { CopilotChatClient, ChatSession } from "ghc-isomorphic-adapter";

const client = new CopilotChatClient();
await client.init();

const session = new ChatSession(client, {
  model: "gpt-5-mini",
  systemPrompt: "You are a helpful assistant.",
});

// Non-streaming
const reply = await session.send("What is TypeScript?");
console.log(reply);

// Streaming (same session, maintains context)
for await (const chunk of session.sendStream("Tell me more.")) {
  process.stdout.write(chunk);
}
```

## Tool Calling

Define tools and handlers — the session runs the tool-call loop automatically:

```ts
import { ChatSession, type Tool, type ToolHandler } from "ghc-isomorphic-adapter";

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

const toolHandlers: Record<string, ToolHandler> = {
  get_weather: async (args) => {
    return JSON.stringify({ city: args.city, temp: "22°C", condition: "Sunny" });
  },
};

const session = new ChatSession(client, {
  model: "gpt-5-mini",
  tools,
  toolHandlers,
  maxToolRounds: 5, // default: 10
});

// The session automatically invokes tool handlers and continues the conversation
const answer = await session.send("What's the weather in Rome?");
```

## GitHub Enterprise

```ts
const client = new CopilotChatClient({
  enterpriseUri: "https://github.mycompany.com",
});
```

## API Reference

### `CopilotChatClient`

| Method | Description |
|--------|-------------|
| `new CopilotChatClient(options?)` | Create client. Options: `token`, `apiEndpoint`, `editorVersion`, `enterpriseUri`, `githubApiUrl` |
| `init()` | Resolve token, exchange for session token, discover endpoint. **Must call first.** |
| `initWithDeviceFlow(onCodes, options?)` | Interactive OAuth device flow auth. Returns the GitHub token. |
| `getModels(forceRefresh?)` | List available chat models |
| `complete(request, options?)` | Non-streaming chat completion |
| `stream(request, options?)` | Streaming chat completion → `AsyncGenerator<ResponseEvent>` |
| `getApiEndpoint()` | Get resolved API endpoint |

### `ChatSession`

| Method | Description |
|--------|-------------|
| `new ChatSession(client, options)` | Create session. Options: `model`, `systemPrompt?`, `tools?`, `toolHandlers?`, `temperature?`, `maxToolRounds?` |
| `send(content, options?)` | Send message, return full response (handles tool loops) |
| `sendStream(content, options?)` | Stream response chunks → `AsyncGenerator<string>` |
| `getMessages()` | Get conversation history |
| `addUserMessage(content)` | Manually add user message |
| `addAssistantMessage(content, toolCalls?)` | Manually add assistant message |
| `addToolResult(toolCallId, content)` | Manually add tool result |
| `clear(keepSystemPrompt?)` | Clear history |

### Standalone Functions

| Function | Description |
|----------|-------------|
| `resolveToken(explicit?)` | Resolve GitHub token (explicit → env → config) |
| `readTokenFromConfig(domain?)` | Read token from Copilot config files (Node.js only) |
| `exchangeToken(githubToken, apiUrl?)` | Exchange GitHub token for Copilot session token |
| `TokenManager` | Auto-refreshing session token manager |
| `startDeviceFlow(options?)` | Start OAuth device flow (returns codes) |
| `pollDeviceFlow(codes, options?)` | Poll until user completes device flow |
| `fetchModels(token, endpoint, editorVersion?)` | Fetch and filter available models |
| `parseSSEStream(response)` | Parse a fetch Response as SSE → `AsyncIterable<ResponseEvent>` |

