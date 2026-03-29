import { resolveToken, saveToken } from "./auth.js";
import { startDeviceFlow, pollDeviceFlow } from "./device-flow.js";
import { CopilotApiError } from "./errors.js";
import { fetchModels } from "./models.js";
import { parseSSEStream } from "./streaming.js";
import { TokenManager } from "./token-exchange.js";
import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatMessagePart,
  CopilotClientOptions,
  CopilotTokenInfo,
  DeviceFlowCodes,
  InteractionType,
  Model,
  ResponseEvent,
} from "./types.js";

const DEFAULT_EDITOR_VERSION = "Neovim/0.9.5";

/**
 * Build the HTTP headers expected by the Copilot Chat API.
 */
export function buildHeaders(
  sessionToken: string,
  options?: {
    editorVersion?: string;
    isUserInitiated?: boolean;
    interactionType?: InteractionType;
    hasVision?: boolean;
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sessionToken}`,
    "Content-Type": "application/json",
    "Editor-Version": options?.editorVersion ?? DEFAULT_EDITOR_VERSION,
    "Editor-Plugin-Version": "copilot.vim/1.41.0",
    "Copilot-Integration-Id": "vscode-chat",
    "X-GitHub-Api-Version": "2025-10-01",
  };

  if (options?.isUserInitiated !== undefined) {
    headers["X-Initiator"] = options.isUserInitiated ? "user" : "agent";
  }

  if (options?.interactionType) {
    headers["X-Interaction-Type"] = options.interactionType;
    headers["OpenAI-Intent"] = options.interactionType;
  }

  if (options?.hasVision) {
    headers["Copilot-Vision-Request"] = "true";
  }

  return headers;
}

/**
 * Main client for interacting with GitHub Copilot Chat.
 *
 * Auth flow:
 *  1. Resolve a GitHub token (ghu_, ghp_, github_pat_) from options/env/config
 *  2. Exchange it for a short-lived Copilot session token
 *     via `api.github.com/copilot_internal/v2/token`
 *  3. Use the session token (+ discovered API endpoint) for all API calls
 *  4. Auto-refresh the session token before it expires
 */
export class CopilotChatClient {
  private tokenManager!: TokenManager;
  private apiEndpoint!: string;
  private editorVersion: string;
  private enterpriseUri?: string;
  private githubApiUrl?: string;
  private explicitToken?: string;
  private explicitEndpoint?: string;
  private fetchFn: typeof globalThis.fetch;
  private models: Model[] | null = null;
  private initialized = false;

  constructor(options: CopilotClientOptions = {}) {
    this.explicitToken = options.token;
    this.explicitEndpoint = options.apiEndpoint;
    this.editorVersion = options.editorVersion ?? DEFAULT_EDITOR_VERSION;
    this.enterpriseUri = options.enterpriseUri;
    this.githubApiUrl = options.githubApiUrl;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Initialize the client: resolve GitHub token, exchange for Copilot session token,
   * and discover the API endpoint.
   * Must be called before using other methods.
   */
  async init(): Promise<void> {
    const githubToken = await resolveToken(this.explicitToken);
    this.tokenManager = new TokenManager(githubToken, this.githubApiUrl, this.fetchFn);

    // Exchange token — this also gives us the API endpoint
    const info = await this.tokenManager.getToken();
    this.apiEndpoint = this.explicitEndpoint ?? info.endpoints.api;
    this.initialized = true;
  }

  /**
   * Initialize the client using the OAuth device flow.
   * Guides the user through browser-based authorization.
   *
   * @param onCodes - Callback with the user code & URL to display to the user.
   * @returns The GitHub OAuth token for future use.
   *
   */
  async initWithDeviceFlow(
    onCodes: (codes: DeviceFlowCodes) => void,
    options?: { githubUrl?: string; onPoll?: () => void; persist?: boolean },
  ): Promise<string> {
    const githubUrl = options?.githubUrl ??
      (this.enterpriseUri ? this.enterpriseUri : undefined);

    const codes = await startDeviceFlow({ githubUrl });
    onCodes(codes);

    const githubToken = await pollDeviceFlow(codes, {
      githubUrl,
      onPoll: options?.onPoll,
    });

    // Persist token to ~/.config/github-copilot/hosts.json so next init() finds it
    if (options?.persist !== false) {
      await saveToken(githubToken);
    }

    this.tokenManager = new TokenManager(githubToken, this.githubApiUrl, this.fetchFn);
    const info = await this.tokenManager.getToken();
    this.apiEndpoint = this.explicitEndpoint ?? info.endpoints.api;
    this.initialized = true;

    return githubToken;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error(
        "CopilotChatClient not initialized. Call init() or initWithDeviceFlow() first.",
      );
    }
  }

  /** Get a valid Copilot session token (auto-refreshed). */
  private async getSessionToken(): Promise<string> {
    const info = await this.tokenManager.getToken();
    // Update endpoint if it changed
    if (!this.explicitEndpoint) {
      this.apiEndpoint = info.endpoints.api;
    }
    return info.token;
  }

  /**
   * Fetch the list of available chat models.
   */
  async getModels(forceRefresh = false): Promise<Model[]> {
    this.ensureInit();
    if (!this.models || forceRefresh) {
      const sessionToken = await this.getSessionToken();
      this.models = await fetchModels(
        sessionToken,
        this.apiEndpoint,
        this.editorVersion,
        this.fetchFn,
      );
    }
    return this.models;
  }

  /**
   * Send a non-streaming chat completion request.
   */
  async complete(
    request: ChatCompletionRequest,
    options?: {
      isUserInitiated?: boolean;
      interactionType?: InteractionType;
    },
  ): Promise<ResponseEvent> {
    this.ensureInit();

    const body: ChatCompletionRequest = { ...request, stream: false };
    const res = await this.sendRequest(body, options);

    if (!res.ok) {
      throw new CopilotApiError(res.status, await res.text());
    }

    return (await res.json()) as ResponseEvent;
  }

  /**
   * Send a streaming chat completion request.
   * Returns an async iterable of ResponseEvent chunks.
   */
  async *stream(
    request: ChatCompletionRequest,
    options?: {
      isUserInitiated?: boolean;
      interactionType?: InteractionType;
    },
  ): AsyncGenerator<ResponseEvent> {
    this.ensureInit();

    const body: ChatCompletionRequest = { ...request, stream: true };
    const res = await this.sendRequest(body, options);

    if (!res.ok) {
      throw new CopilotApiError(res.status, await res.text());
    }

    yield* parseSSEStream(res);
  }

  /** The resolved API endpoint (available after init). */
  getApiEndpoint(): string {
    this.ensureInit();
    return this.apiEndpoint;
  }

  private async sendRequest(
    body: ChatCompletionRequest,
    options?: {
      isUserInitiated?: boolean;
      interactionType?: InteractionType;
    },
  ): Promise<Response> {
    const sessionToken = await this.getSessionToken();
    const url = `${this.apiEndpoint}/chat/completions`;
    const hasVision = detectVision(body.messages);

    const headers = buildHeaders(sessionToken, {
      editorVersion: this.editorVersion,
      isUserInitiated: options?.isUserInitiated,
      interactionType: options?.interactionType,
      hasVision,
    });

    return this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
}

function detectVision(messages: ChatMessage[]): boolean {
  return messages.some((msg) => {
    if (msg.role === "system") return false;
    const content = msg.content;
    if (typeof content === "string") return false;
    return (content as ChatMessagePart[]).some(
      (part) => part.type === "image_url",
    );
  });
}
