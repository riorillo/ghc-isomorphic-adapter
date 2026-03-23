import { CopilotApiError } from "./errors.js";

const DEFAULT_GRAPHQL_URL = "https://api.github.com/graphql";
const DEFAULT_API_ENDPOINT = "https://api.githubcopilot.com";

interface GraphQLResponse {
  data?: {
    viewer: {
      copilotEndpoints: {
        api: string;
      };
    };
  };
}

/**
 * Discover the Copilot API endpoint via GitHub GraphQL.
 * Falls back to https://api.githubcopilot.com on failure.
 */
export async function discoverApiEndpoint(
  token: string,
  options?: { graphqlUrl?: string; enterpriseUri?: string },
): Promise<string> {
  const graphqlUrl = options?.graphqlUrl ?? buildGraphqlUrl(options?.enterpriseUri);

  try {
    const body = JSON.stringify({
      query: "query { viewer { copilotEndpoints { api } } }",
    });

    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      throw new CopilotApiError(res.status, await res.text());
    }

    const json = (await res.json()) as GraphQLResponse;
    const endpoint = json.data?.viewer?.copilotEndpoints?.api;
    if (endpoint) return endpoint;
  } catch {
    // Fall through to default
  }

  return DEFAULT_API_ENDPOINT;
}

function buildGraphqlUrl(enterpriseUri?: string): string {
  if (!enterpriseUri) return DEFAULT_GRAPHQL_URL;

  const domain = parseDomain(enterpriseUri);
  return `https://${domain}/api/graphql`;
}

function parseDomain(uri: string): string {
  let cleaned = uri.replace(/\/+$/, "");
  cleaned = cleaned.replace(/^https?:\/\//, "");
  return cleaned.split("/")[0] ?? cleaned;
}
