import { CopilotAuthError } from "./errors.js";

const COPILOT_OAUTH_ENV_VAR = "GH_COPILOT_TOKEN";
const LOCAL_STORAGE_KEY = "ghc_oauth_token";

/**
 * Resolve a Copilot OAuth token.
 * Priority: explicit token > environment variable > localStorage (browser) > config files (Node.js).
 */
export async function resolveToken(explicit?: string): Promise<string> {
  if (explicit) return explicit;

  // Environment variable (Node.js)
  if (typeof process !== "undefined" && process.env?.[COPILOT_OAUTH_ENV_VAR]) {
    return process.env[COPILOT_OAUTH_ENV_VAR]!;
  }

  // localStorage (browser)
  const fromStorage = readTokenFromStorage();
  if (fromStorage) return fromStorage;

  // Config files (Node.js only)
  const fromConfig = await readTokenFromConfig();
  if (fromConfig) return fromConfig;

  throw new CopilotAuthError(
    "No Copilot OAuth token found. Provide one explicitly, set GH_COPILOT_TOKEN, " +
      "or sign in via device flow.",
  );
}

// ── Browser: localStorage ─────────────────────────────────────────

/**
 * Read the OAuth token from localStorage.
 * Browser only – returns null in Node.js.
 */
export function readTokenFromStorage(): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(LOCAL_STORAGE_KEY);
    }
  } catch {
    // localStorage not available or blocked
  }
  return null;
}

/**
 * Save the OAuth token to localStorage.
 * Browser only – no-op in Node.js.
 */
export function saveTokenToStorage(token: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_KEY, token);
    }
  } catch {
    // localStorage not available or blocked
  }
}

/**
 * Remove the OAuth token from localStorage.
 */
export function clearTokenFromStorage(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {
    // localStorage not available or blocked
  }
}

// ── Node.js: config files ─────────────────────────────────────────

/**
 * Read the OAuth token from GitHub Copilot config files.
 * Node.js only – returns null in browser environments.
 */
export async function readTokenFromConfig(
  domain = "github.com",
): Promise<string | null> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");

    const configDir = getConfigDir(path, os);
    const filenames = ["hosts.json", "apps.json"];

    for (const filename of filenames) {
      const filePath = path.join(configDir, filename);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const token = extractToken(raw, domain);
        if (token) return token;
      } catch {
        // File doesn't exist or isn't readable – try next
      }
    }

    return null;
  } catch {
    // node:fs not available (browser) – return null
    return null;
  }
}

function getConfigDir(
  path: typeof import("node:path"),
  os: typeof import("node:os"),
): string {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "github-copilot",
    );
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  const base = xdgConfig || path.join(os.homedir(), ".config");
  return path.join(base, "github-copilot");
}

function extractToken(raw: string, domain: string): string | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith(domain) && typeof value === "object" && value !== null) {
        const token = (value as Record<string, unknown>).oauth_token;
        if (typeof token === "string") return token;
      }
    }
  } catch {
    // Malformed JSON – ignore
  }
  return null;
}

/**
 * Persist a GitHub OAuth token.
 * - **Node.js**: writes to `~/.config/github-copilot/hosts.json`
 * - **Browser**: writes to `localStorage`
 */
export async function saveToken(
  token: string,
  options?: { domain?: string; user?: string; githubAppId?: string },
): Promise<void> {
  // Browser: localStorage
  saveTokenToStorage(token);

  // Node.js: hosts.json
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");

    const configDir = getConfigDir(path, os);
    const filePath = path.join(configDir, "hosts.json");

    const domain = options?.domain ?? "github.com";
    const githubAppId = options?.githubAppId ?? "Iv1.b507a08c87ecfe98";

    let existing: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet
    }

    existing[domain] = {
      ...(typeof existing[domain] === "object" && existing[domain] !== null
        ? (existing[domain] as Record<string, unknown>)
        : {}),
      oauth_token: token,
      githubAppId,
      ...(options?.user ? { user: options.user } : {}),
    };

    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch {
    // Browser or write failure – localStorage already handled above
  }
}
