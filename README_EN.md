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

1. **Resolve a GitHub token** — from explicit `token` option, `GH_COPILOT_TOKEN` env, `localStorage` (browser), or `~/.config/github-copilot/hosts.json` (Node.js)
2. **Exchange it** for a short-lived Copilot session token via `api.github.com/copilot_internal/v2/token`
3. **Auto-refresh** the session token before it expires

### Supported token types

| Token | How to get |
|-------|-----------|
| `ghu_...` (OAuth) | Device flow or Copilot editor sign-in |
| `ghp_...` (Classic PAT) | github.com → Settings → Tokens (needs `copilot` scope) |

### Node.js

```ts
const client = new CopilotChatClient();

try {
  // Finds token in env var or ~/.config/github-copilot/hosts.json
  await client.init();
} catch {
  // First time only — interactive device flow, saves to hosts.json
  await client.initWithDeviceFlow(
    (codes) => console.log(`Open ${codes.verificationUri} and enter: ${codes.userCode}`),
  );
}
```

### Browser

All GitHub/Copilot API endpoints block CORS preflight requests from browsers.
The `extension/` directory contains a minimal Chrome extension (Manifest V3) that proxies **all** requests through its service worker, bypassing CORS entirely.

#### Installing the extension

1. Open **Chrome** (or any Chromium-based browser: Edge, Brave, Arc, …)
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder inside this repository
6. The extension **GHC Auth Bridge** should appear in the list with a green toggle

> After updating the extension files, click the ↻ refresh button on the extension card, then **reload the page**.

#### Usage

Use `createExtensionFetch()` as the fetch function for the client:

```ts
import {
  CopilotChatClient, createExtensionFetch, requestTokenFromExtension,
} from "ghc-isomorphic-adapter";

// All HTTP requests go through the extension (no CORS)
const fetchFn = createExtensionFetch();
let client = new CopilotChatClient({ fetchFn });

try {
  await client.init(); // reads token from localStorage
} catch {
  // First time: device flow via extension
  const token = await requestTokenFromExtension((codes) => {
    document.body.textContent = `Open ${codes.verificationUri} and enter: ${codes.userCode}`;
  });
  client = new CopilotChatClient({ token, fetchFn });
  await client.init();
}
// ✅ Streaming, models, chat — everything works
```

See `examples/browser.html` for a full working chat UI.

**Without the extension (manual token injection):**

```ts
import { CopilotChatClient, createExtensionFetch, saveTokenToStorage } from "ghc-isomorphic-adapter";

saveTokenToStorage("ghu_..."); // one-time
const client = new CopilotChatClient({ fetchFn: createExtensionFetch() });
await client.init(); // reads from localStorage, all requests go through extension
```

### Token persistence

| Environment | Storage | Auto on `initWithDeviceFlow` |
|---|---|---|
| **Node.js** | `~/.config/github-copilot/hosts.json` | ✅ |
| **Browser** | `localStorage` (`ghc_oauth_token`) | ✅ |

Manual control:

```ts
import {
  saveToken, readTokenFromConfig, readTokenFromStorage, clearTokenFromStorage,
} from "ghc-isomorphic-adapter";

await saveToken("ghu_...");              // writes to both localStorage + hosts.json
readTokenFromStorage();                  // browser: read from localStorage
await readTokenFromConfig();             // Node.js: read from hosts.json
clearTokenFromStorage();                 // browser: remove from localStorage
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
| `resolveToken(explicit?)` | Resolve GitHub token (explicit → env → localStorage → config) |
| `readTokenFromStorage()` | Read token from `localStorage` (browser) |
| `saveTokenToStorage(token)` | Write token to `localStorage` (browser) |
| `clearTokenFromStorage()` | Remove token from `localStorage` (browser) |
| `readTokenFromConfig(domain?)` | Read token from Copilot config files (Node.js) |
| `saveToken(token, options?)` | Persist token (localStorage + hosts.json) |
| `exchangeToken(githubToken, apiUrl?)` | Exchange GitHub token for Copilot session token |
| `TokenManager` | Auto-refreshing session token manager |
| `startDeviceFlow(options?)` | Start OAuth device flow (Node.js only) |
| `pollDeviceFlow(codes, options?)` | Poll until user completes device flow (Node.js only) |
| `requestTokenFromExtension(onCodes, options?)` | Device flow via Auth Bridge extension (browser) |
| `createExtensionFetch()` | Returns a `fetch` fn that proxies through the extension (browser) |
| `fetchModels(token, endpoint, editorVersion?)` | Fetch and filter available models |
| `parseSSEStream(response)` | Parse a fetch Response as SSE → `AsyncIterable<ResponseEvent>` |

