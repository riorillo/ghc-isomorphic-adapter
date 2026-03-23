import { CopilotAuthError } from "./errors.js";
import type { DeviceFlowCodes } from "./types.js";

// GitHub Copilot Vim/Neovim client ID (widely used by third-party Copilot clients)
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface PollResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Start the OAuth device flow to obtain a GitHub token with Copilot access.
 *
 * Returns the device/user codes for the user to authorize.
 * Call `pollDeviceFlow()` to wait for authorization.
 *
 * @example
 * ```ts
 * const codes = await startDeviceFlow();
 * console.log(`Go to ${codes.verificationUri} and enter: ${codes.userCode}`);
 * const token = await pollDeviceFlow(codes);
 * ```
 */
export async function startDeviceFlow(
  options?: { githubUrl?: string },
): Promise<DeviceFlowCodes> {
  const baseUrl = (options?.githubUrl ?? "https://github.com").replace(
    /\/+$/,
    "",
  );

  const res = await fetch(`${baseUrl}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "copilot",
    }),
  });

  if (!res.ok) {
    throw new CopilotAuthError(
      `Device flow initiation failed: ${res.status} ${await res.text()}`,
    );
  }

  const data = (await res.json()) as DeviceCodeResponse;

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

/**
 * Poll for the user to complete the device flow authorization.
 * Returns the GitHub OAuth token (ghu_...) once the user authorizes.
 *
 * @param codes - The codes returned by `startDeviceFlow()`
 * @param onPoll - Optional callback invoked each poll iteration (for progress indicators)
 */
export async function pollDeviceFlow(
  codes: DeviceFlowCodes,
  options?: {
    githubUrl?: string;
    onPoll?: () => void;
  },
): Promise<string> {
  const baseUrl = (options?.githubUrl ?? "https://github.com").replace(
    /\/+$/,
    "",
  );
  const interval = Math.max(codes.interval, 5) * 1000;
  const deadline = Date.now() + codes.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    options?.onPoll?.();

    const res = await fetch(`${baseUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: codes.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) continue;

    const data = (await res.json()) as PollResponse;

    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "authorization_pending" || data.error === "slow_down") {
      continue;
    }

    if (data.error === "expired_token") {
      throw new CopilotAuthError("Device flow authorization expired. Please try again.");
    }

    if (data.error === "access_denied") {
      throw new CopilotAuthError("Device flow authorization was denied by the user.");
    }

    if (data.error) {
      throw new CopilotAuthError(`Device flow error: ${data.error} – ${data.error_description}`);
    }
  }

  throw new CopilotAuthError("Device flow authorization timed out.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
