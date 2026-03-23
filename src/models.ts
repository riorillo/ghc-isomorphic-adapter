import { CopilotApiError } from "./errors.js";
import type { Model } from "./types.js";
import { buildHeaders } from "./client.js";

interface ModelSchema {
  data: Model[];
}

/**
 * Fetch the list of available Copilot Chat models.
 * Filters to chat-type, picker-enabled, policy-enabled models.
 */
export async function fetchModels(
  token: string,
  apiEndpoint: string,
  editorVersion?: string,
): Promise<Model[]> {
  const url = `${apiEndpoint}/models`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token, { editorVersion }),
  });

  if (!res.ok) {
    throw new CopilotApiError(res.status, await res.text());
  }

  const schema = (await res.json()) as ModelSchema;
  const allModels = schema.data ?? [];

  const models = allModels.filter(
    (m) =>
      m.model_picker_enabled &&
      m.capabilities.type === "chat" &&
      (!m.policy || m.policy.state === "enabled"),
  );

  // Put the default model first
  const defaultIdx = models.findIndex((m) => m.is_chat_default);
  if (defaultIdx > 0) {
    const [defaultModel] = models.splice(defaultIdx, 1);
    models.unshift(defaultModel);
  }

  return models;
}
