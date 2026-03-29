# ghc-isomorphic-adapter

> ⚠️ **Solo per scopi educativi.** Questa libreria è destinata all'apprendimento e alla sperimentazione. Non è affiliata, approvata o supportata da GitHub. Usala a tuo rischio e in conformità con i Termini di Servizio di GitHub.

Libreria TypeScript minimale e isomorfica per la **GitHub Copilot Chat API**.  
Supporta streaming, sessioni, chiamate a strumenti e gestione automatica dei token.

## Installazione

```bash
npm install ghc-isomorphic-adapter
```

## Avvio rapido

```ts
import { CopilotChatClient } from "ghc-isomorphic-adapter";

const client = new CopilotChatClient();

// Opzione 1: Device flow (interattivo – consigliato al primo utilizzo)
const ghToken = await client.initWithDeviceFlow((codes) => {
  console.log(`Apri ${codes.verificationUri} e inserisci: ${codes.userCode}`);
});
// Salva ghToken per usi futuri (export GH_COPILOT_TOKEN=ghu_...)

// Opzione 2: Token esistente (env, file di configurazione o esplicito)
const client2 = new CopilotChatClient({ token: "ghu_..." });
await client2.init();
```

## Autenticazione

La libreria gestisce l'intero flusso di autenticazione Copilot:

1. **Risolve un token GitHub** — da opzione `token` esplicita, variabile d'ambiente `GH_COPILOT_TOKEN`, `localStorage` (browser) o `~/.config/github-copilot/hosts.json` (Node.js)
2. **Lo scambia** con un token di sessione Copilot a breve scadenza tramite `api.github.com/copilot_internal/v2/token`
3. **Aggiorna automaticamente** il token di sessione prima della scadenza

### Tipi di token supportati

| Token | Come ottenerlo |
|-------|----------------|
| `ghu_...` (OAuth) | Device flow o accesso tramite editor Copilot |
| `ghp_...` (Classic PAT) | github.com → Impostazioni → Token (richiede scope `copilot`) |

### Node.js

```ts
const client = new CopilotChatClient();

try {
  // Trova il token nella variabile d'ambiente o in ~/.config/github-copilot/hosts.json
  await client.init();
} catch {
  // Solo al primo utilizzo — device flow interattivo, salva in hosts.json
  await client.initWithDeviceFlow(
    (codes) => console.log(`Apri ${codes.verificationUri} e inserisci: ${codes.userCode}`),
  );
}
```

### Browser

Tutti gli endpoint API di GitHub/Copilot bloccano le richieste preflight CORS dai browser.
La cartella `extension/` contiene una minima estensione Chrome (Manifest V3) che fa passare **tutte** le richieste attraverso il suo service worker, bypassando completamente il CORS.

#### Installazione dell'estensione

1. Apri **Chrome** (o qualsiasi browser basato su Chromium: Edge, Brave, Arc, …)
2. Naviga su `chrome://extensions`
3. Abilita la **modalità sviluppatore** (toggle in alto a destra)
4. Clicca su **Carica estensione non pacchettizzata**
5. Seleziona la cartella `extension/` all'interno di questo repository
6. L'estensione **GHC Auth Bridge** dovrebbe apparire nell'elenco con un toggle verde

> Dopo aver aggiornato i file dell'estensione, clicca il pulsante ↻ aggiorna sulla scheda dell'estensione, poi **ricarica la pagina**.

#### Utilizzo

Usa `createExtensionFetch()` come funzione fetch per il client:

```ts
import {
  CopilotChatClient, createExtensionFetch, requestTokenFromExtension,
} from "ghc-isomorphic-adapter";

// Tutte le richieste HTTP passano attraverso l'estensione (nessun CORS)
const fetchFn = createExtensionFetch();
let client = new CopilotChatClient({ fetchFn });

try {
  await client.init(); // legge il token da localStorage
} catch {
  // Prima volta: device flow tramite estensione
  const token = await requestTokenFromExtension((codes) => {
    document.body.textContent = `Apri ${codes.verificationUri} e inserisci: ${codes.userCode}`;
  });
  client = new CopilotChatClient({ token, fetchFn });
  await client.init();
}
// ✅ Streaming, modelli, chat — tutto funziona
```

Vedi `examples/browser.html` per un'interfaccia chat completa e funzionante.

**Senza l'estensione (iniezione manuale del token):**

```ts
import { CopilotChatClient, createExtensionFetch, saveTokenToStorage } from "ghc-isomorphic-adapter";

saveTokenToStorage("ghu_..."); // una volta sola
const client = new CopilotChatClient({ fetchFn: createExtensionFetch() });
await client.init(); // legge da localStorage, tutte le richieste passano per l'estensione
```

### Persistenza del token

| Ambiente | Storage | Automatico con `initWithDeviceFlow` |
|----------|---------|-------------------------------------|
| **Node.js** | `~/.config/github-copilot/hosts.json` | ✅ |
| **Browser** | `localStorage` (`ghc_oauth_token`) | ✅ |

Controllo manuale:

```ts
import {
  saveToken, readTokenFromConfig, readTokenFromStorage, clearTokenFromStorage,
} from "ghc-isomorphic-adapter";

await saveToken("ghu_...");              // scrive sia in localStorage che in hosts.json
readTokenFromStorage();                  // browser: legge da localStorage
await readTokenFromConfig();             // Node.js: legge da hosts.json
clearTokenFromStorage();                 // browser: rimuove da localStorage
```

## Lista modelli

```ts
const models = await client.getModels();
console.log(models.map((m) => `${m.id} (${m.vendor})`));
```

## Chat Completion (non-streaming)

```ts
const response = await client.complete({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Ciao!" }],
});

console.log(response.choices[0].message?.content);
```

## Streaming

```ts
for await (const event of client.stream({
  model: "gpt-5-mini",
  messages: [{ role: "user", content: "Spiega TypeScript in 3 frasi." }],
})) {
  process.stdout.write(event.choices[0]?.delta?.content ?? "");
}
```

## Sessioni

`ChatSession` mantiene la cronologia della conversazione e gestisce automaticamente i cicli di chiamata agli strumenti:

```ts
import { CopilotChatClient, ChatSession } from "ghc-isomorphic-adapter";

const client = new CopilotChatClient();
await client.init();

const session = new ChatSession(client, {
  model: "gpt-5-mini",
  systemPrompt: "Sei un assistente utile.",
});

// Non-streaming
const reply = await session.send("Cos'è TypeScript?");
console.log(reply);

// Streaming (stessa sessione, mantiene il contesto)
for await (const chunk of session.sendStream("Dimmi di più.")) {
  process.stdout.write(chunk);
}
```

## Chiamata a strumenti (Tool Calling)

Definisci strumenti e handler — la sessione esegue automaticamente il ciclo di tool call:

```ts
import { ChatSession, type Tool, type ToolHandler } from "ghc-isomorphic-adapter";

const tools: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Ottieni il meteo per una città",
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
    return JSON.stringify({ city: args.city, temp: "22°C", condition: "Soleggiato" });
  },
};

const session = new ChatSession(client, {
  model: "gpt-5-mini",
  tools,
  toolHandlers,
  maxToolRounds: 5, // default: 10
});

// La sessione invoca automaticamente gli handler degli strumenti e continua la conversazione
const answer = await session.send("Che tempo fa a Roma?");
```

## GitHub Enterprise

```ts
const client = new CopilotChatClient({
  enterpriseUri: "https://github.miazienda.com",
});
```

## Riferimento API

### `CopilotChatClient`

| Metodo | Descrizione |
|--------|-------------|
| `new CopilotChatClient(options?)` | Crea il client. Opzioni: `token`, `apiEndpoint`, `editorVersion`, `enterpriseUri`, `githubApiUrl` |
| `init()` | Risolve il token, lo scambia per un token di sessione e scopre l'endpoint. **Da chiamare per primo.** |
| `initWithDeviceFlow(onCodes, options?)` | Autenticazione interattiva tramite OAuth device flow. Restituisce il token GitHub. |
| `getModels(forceRefresh?)` | Elenca i modelli di chat disponibili |
| `complete(request, options?)` | Chat completion non-streaming |
| `stream(request, options?)` | Chat completion in streaming → `AsyncGenerator<ResponseEvent>` |
| `getApiEndpoint()` | Ottieni l'endpoint API risolto |

### `ChatSession`

| Metodo | Descrizione |
|--------|-------------|
| `new ChatSession(client, options)` | Crea una sessione. Opzioni: `model`, `systemPrompt?`, `tools?`, `toolHandlers?`, `temperature?`, `maxToolRounds?` |
| `send(content, options?)` | Invia un messaggio, restituisce la risposta completa (gestisce i cicli di tool call) |
| `sendStream(content, options?)` | Risposta in streaming → `AsyncGenerator<string>` |
| `getMessages()` | Ottieni la cronologia della conversazione |
| `addUserMessage(content)` | Aggiungi manualmente un messaggio utente |
| `addAssistantMessage(content, toolCalls?)` | Aggiungi manualmente un messaggio dell'assistente |
| `addToolResult(toolCallId, content)` | Aggiungi manualmente un risultato di uno strumento |
| `clear(keepSystemPrompt?)` | Cancella la cronologia |

### Funzioni standalone

| Funzione | Descrizione |
|----------|-------------|
| `resolveToken(explicit?)` | Risolve il token GitHub (esplicito → env → localStorage → config) |
| `readTokenFromStorage()` | Legge il token da `localStorage` (browser) |
| `saveTokenToStorage(token)` | Scrive il token in `localStorage` (browser) |
| `clearTokenFromStorage()` | Rimuove il token da `localStorage` (browser) |
| `readTokenFromConfig(domain?)` | Legge il token dai file di configurazione Copilot (Node.js) |
| `saveToken(token, options?)` | Persiste il token (localStorage + hosts.json) |
| `exchangeToken(githubToken, apiUrl?)` | Scambia il token GitHub con un token di sessione Copilot |
| `TokenManager` | Gestore del token di sessione con aggiornamento automatico |
| `startDeviceFlow(options?)` | Avvia il device flow OAuth (solo Node.js) |
| `pollDeviceFlow(codes, options?)` | Attende il completamento del device flow da parte dell'utente (solo Node.js) |
| `requestTokenFromExtension(onCodes, options?)` | Device flow tramite estensione Auth Bridge (browser) |
| `createExtensionFetch()` | Restituisce una funzione `fetch` che fa da proxy attraverso l'estensione (browser) |
| `fetchModels(token, endpoint, editorVersion?)` | Recupera e filtra i modelli disponibili |
| `parseSSEStream(response)` | Analizza una risposta fetch come SSE → `AsyncIterable<ResponseEvent>` |
