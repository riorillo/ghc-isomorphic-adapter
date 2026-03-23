import { CopilotApiError, CopilotAuthError } from "./errors.js";
import type { CopilotTokenInfo } from "./types.js";

const DEFAULT_GITHUB_API = "https://api.github.com";
const TOKEN_EXCHANGE_PATH = "/copilot_internal/v2/token";
// Refresh 5 minutes before expiry
const REFRESH_MARGIN_S = 300;

interface TokenExchangeResponse {
  token: string;
  expires_at: number;
  endpoints: {
    api: string;
    [key: string]: string;
  };
}

/**
 * Exchange a GitHub token (ghu_, ghp_, github_pat_) for a short-lived
 * Copilot session token via /copilot_internal/v2/token.
 */
export async function exchangeToken(
  githubToken: string,
  githubApiUrl = DEFAULT_GITHUB_API,
): Promise<CopilotTokenInfo> {
  const url = `${githubApiUrl.replace(/\/+$/, "")}${TOKEN_EXCHANGE_PATH}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    throw new CopilotAuthError(
      "GitHub token is invalid or expired. " +
        "If using a ghu_ token from hosts.json, try re-signing in to Copilot in your editor.",
    );
  }

  if (res.status === 403) {
    const body = await res.text();
    if (body.includes("personal access token")) {
      throw new CopilotAuthError(
        "Your token doesn't have Copilot access. " +
          "Classic PATs (ghp_) need the `copilot` scope. " +
          "Fine-grained PATs (github_pat_) need the 'Copilot' permission. " +
          "Alternatively, use the device flow: CopilotChatClient.deviceFlowAuth()",
      );
    }
    throw new CopilotApiError(res.status, body);
  }

  if (!res.ok) {
    throw new CopilotApiError(res.status, await res.text());
  }

  const data = (await res.json()) as TokenExchangeResponse;

  return {
    token: data.token,
    expiresAt: data.expires_at,
    endpoints: data.endpoints,
  };
}

/**
 * Manages Copilot session tokens with automatic refresh.
 */
export class TokenManager {
  private githubToken: string;
  private githubApiUrl: string;
  private tokenInfo: CopilotTokenInfo | null = null;
  private refreshPromise: Promise<CopilotTokenInfo> | null = null;

  constructor(githubToken: string, githubApiUrl = DEFAULT_GITHUB_API) {
    this.githubToken = githubToken;
    this.githubApiUrl = githubApiUrl;
  }

  /**
   * Get a valid Copilot session token, refreshing if needed.
   */
  async getToken(): Promise<CopilotTokenInfo> {
    if (this.tokenInfo && !this.isExpiringSoon()) {
      return this.tokenInfo;
    }

    // Deduplicate concurrent refresh calls
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh();
    }

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private isExpiringSoon(): boolean {
    if (!this.tokenInfo) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= this.tokenInfo.expiresAt - REFRESH_MARGIN_S;
  }

  private async refresh(): Promise<CopilotTokenInfo> {
    this.tokenInfo = await exchangeToken(this.githubToken, this.githubApiUrl);
    return this.tokenInfo;
  }
}
