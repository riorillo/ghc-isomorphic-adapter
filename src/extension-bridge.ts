import { saveTokenToStorage } from "./auth.js";

/**
 * Perform the GitHub device flow via the GHC Auth Bridge browser extension.
 *
 * The extension's service worker makes the fetch calls to github.com
 * (no CORS restrictions), then returns the token via window.postMessage.
 *
 * @param onCodes Called with the user code and verification URL.
 * @param options.timeout Max wait in ms (default: 300 000 = 5 min).
 * @returns The GitHub OAuth token (`ghu_…`), also saved to localStorage.
 */
export function requestTokenFromExtension(
  onCodes: (codes: { userCode: string; verificationUri: string }) => void,
  options?: { timeout?: number },
): Promise<string> {
  const timeout = options?.timeout ?? 300_000;

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Extension auth timed out"));
    }, timeout);

    function handler(event: MessageEvent) {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || typeof d.type !== "string") return;

      if (d.type === "ghc-device-codes") {
        onCodes({ userCode: d.userCode, verificationUri: d.verificationUri });
        return;
      }

      if (d.type === "ghc-auth-result") {
        cleanup();
        if (d.ok) {
          saveTokenToStorage(d.token);
          resolve(d.token);
        } else {
          reject(new Error(d.error ?? "Extension auth failed"));
        }
      }
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
    }

    window.addEventListener("message", handler);
    window.postMessage({ type: "ghc-device-flow" }, "*");
  });
}

// ── Extension fetch proxy ─────────────────────────────────────────

let nextId = 0;

/**
 * Create a `fetch`-compatible function that proxies all HTTP requests through
 * the GHC Auth Bridge extension. This bypasses CORS entirely since the
 * extension's service worker makes the actual network calls.
 *
 * Supports real streaming: the Response is resolved as soon as headers arrive,
 * and `response.body` is a ReadableStream fed by chunks from the extension.
 *
 * @example
 * ```ts
 * const client = new CopilotChatClient({ fetchFn: createExtensionFetch() });
 * ```
 */
export function createExtensionFetch(): typeof globalThis.fetch {
  return async function extensionFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const id = `ghc-${++nextId}`;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else {
        Object.assign(headers, h);
      }
    }
    const body = init?.body ? (typeof init.body === "string" ? init.body : undefined) : undefined;

    return new Promise<Response>((resolve, reject) => {
      const encoder = new TextEncoder();
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

      function handler(event: MessageEvent) {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.id !== id) return;

        switch (d.type) {
          case "ghc-fetch-head": {
            // Headers arrived — construct the Response with a streaming body
            const stream = new ReadableStream<Uint8Array>({
              start(c) { controller = c; },
            });
            resolve(new Response(stream, {
              status: d.status,
              headers: new Headers(d.headers || {}),
            }));
            break;
          }
          case "ghc-fetch-chunk":
            controller?.enqueue(encoder.encode(d.chunk));
            break;
          case "ghc-fetch-done":
            controller?.close();
            window.removeEventListener("message", handler);
            break;
          case "ghc-fetch-result":
            // Error from sendResponse callback (extension context invalidated etc.)
            if (!d.ok) {
              window.removeEventListener("message", handler);
              reject(new TypeError(`Extension fetch failed: ${d.error}`));
            }
            break;
        }
      }

      window.addEventListener("message", handler);
      window.postMessage({ type: "ghc-fetch", id, url, method, headers, body }, "*");
    });
  };
}
