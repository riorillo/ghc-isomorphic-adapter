// ── Roles & Messages ──────────────────────────────────────────────

export type Role = "user" | "assistant" | "system" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImageUrlPart {
  type: "image_url";
  image_url: { url: string };
}

export type ChatMessagePart = TextPart | ImageUrlPart;

export type ChatMessageContent = string | ChatMessagePart[];

export interface UserMessage {
  role: "user";
  content: ChatMessageContent;
}

export interface AssistantMessage {
  role: "assistant";
  content: ChatMessageContent;
  tool_calls?: ToolCall[];
  reasoning_opaque?: string;
  reasoning_text?: string;
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface ToolMessage {
  role: "tool";
  content: ChatMessageContent;
  tool_call_id: string;
}

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolMessage;

// ── Tools ─────────────────────────────────────────────────────────

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  type: "function";
  function: FunctionDefinition;
}

export type ToolChoice = "auto" | "any" | "none";

export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCallContent;
}

export interface FunctionCallContent {
  name: string;
  arguments: string;
  thought_signature?: string;
}

// ── Request ───────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  n?: number;
  temperature?: number;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  thinking_budget?: number;
}

// ── Response (streaming & non-streaming) ──────────────────────────

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface FunctionChunk {
  name?: string;
  arguments?: string;
  thought_signature?: string;
}

export interface ToolCallChunk {
  index?: number;
  id?: string;
  function?: FunctionChunk;
}

export interface ResponseDelta {
  content?: string | null;
  role?: Role;
  tool_calls?: ToolCallChunk[];
  reasoning_opaque?: string;
  reasoning_text?: string;
}

export interface ResponseChoice {
  index?: number;
  finish_reason?: string | null;
  delta?: ResponseDelta;
  message?: ResponseDelta;
}

export interface ResponseEvent {
  id: string;
  choices: ResponseChoice[];
  usage?: Usage;
}

// ── Models ────────────────────────────────────────────────────────

export type ModelVendor =
  | "OpenAI"
  | "Google"
  | "Anthropic"
  | "xAI"
  | "Unknown";

export interface ModelSupportedFeatures {
  streaming: boolean;
  tool_calls: boolean;
  parallel_tool_calls: boolean;
  vision: boolean;
  thinking: boolean;
  adaptive_thinking: boolean;
  max_thinking_budget?: number;
  min_thinking_budget?: number;
  reasoning_effort: string[];
}

export interface ModelLimits {
  max_context_window_tokens: number;
  max_output_tokens: number;
  max_prompt_tokens: number;
}

export interface ModelCapabilities {
  family: string;
  limits: ModelLimits;
  supports: ModelSupportedFeatures;
  type: string;
  tokenizer?: string;
}

export interface ModelBilling {
  is_premium: boolean;
  multiplier: number;
  restricted_to?: string[];
}

export interface ModelPolicy {
  state: string;
}

export type ModelSupportedEndpoint =
  | "/chat/completions"
  | "/responses"
  | "/v1/messages"
  | string;

export interface Model {
  id: string;
  name: string;
  vendor: ModelVendor;
  billing: ModelBilling;
  capabilities: ModelCapabilities;
  policy?: ModelPolicy;
  is_chat_default: boolean;
  is_chat_fallback: boolean;
  model_picker_enabled: boolean;
  supported_endpoints: ModelSupportedEndpoint[];
}

// ── Client Options ────────────────────────────────────────────────

export type InteractionType =
  | "conversation-panel"
  | "conversation-inline"
  | "conversation-edits"
  | "conversation-terminal"
  | "conversation-agent"
  | "conversation-other";

export interface CopilotClientOptions {
  /**
   * A GitHub token used to obtain a Copilot session token.
   * Accepted formats:
   *  - GitHub OAuth token (`ghu_...`)  – from Copilot editor sign-in
   *  - Classic PAT (`ghp_...`)         – needs the `copilot` scope
   *  - Fine-grained PAT (`github_pat_...`) – needs Copilot permission
   *
   * If omitted, the token is resolved from:
   *  1. `GH_COPILOT_TOKEN` env variable
   *  2. `~/.config/github-copilot/hosts.json` / `apps.json`
   */
  token?: string;
  /** Override the API endpoint (skips token-exchange discovery). */
  apiEndpoint?: string;
  /** Custom editor version header (default: "CopilotChatAdapter/1.0.0"). */
  editorVersion?: string;
  /** GitHub Enterprise Server URI (e.g. "https://github.mycompany.com"). */
  enterpriseUri?: string;
  /** GitHub API base URL (default: "https://api.github.com"). */
  githubApiUrl?: string;
}

// ── Token exchange types ──────────────────────────────────────────

export interface CopilotTokenInfo {
  /** The short-lived Copilot session token (used as Bearer for API calls). */
  token: string;
  /** Unix timestamp (seconds) when the token expires. */
  expiresAt: number;
  /** API endpoints returned by the token exchange. */
  endpoints: {
    api: string;
    [key: string]: string;
  };
}

// ── Device flow types ─────────────────────────────────────────────

export interface DeviceFlowCodes {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

// ── Tool handler (used by ChatSession) ────────────────────────────

export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<string> | string;

export interface SessionOptions {
  model: string;
  systemPrompt?: string;
  tools?: Tool[];
  toolHandlers?: Record<string, ToolHandler>;
  temperature?: number;
  /** Max rounds of automatic tool-call loops (default: 10). */
  maxToolRounds?: number;
}
