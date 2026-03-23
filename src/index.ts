// Core
export { CopilotChatClient } from "./client.js";
export { ChatSession } from "./session.js";

// Auth
export { resolveToken, readTokenFromConfig, saveTokenToConfig } from "./auth.js";
export { exchangeToken, TokenManager } from "./token-exchange.js";
export { startDeviceFlow, pollDeviceFlow } from "./device-flow.js";

// Models
export { fetchModels } from "./models.js";

// Streaming
export { parseSSEStream } from "./streaming.js";

// Errors
export {
  CopilotAuthError,
  CopilotApiError,
  CopilotStreamError,
} from "./errors.js";

// Types
export type {
  Role,
  TextPart,
  ImageUrlPart,
  ChatMessagePart,
  ChatMessageContent,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  ToolMessage,
  ChatMessage,
  FunctionDefinition,
  Tool,
  ToolChoice,
  ToolCall,
  FunctionCallContent,
  ChatCompletionRequest,
  Usage,
  FunctionChunk,
  ToolCallChunk,
  ResponseDelta,
  ResponseChoice,
  ResponseEvent,
  ModelVendor,
  ModelSupportedFeatures,
  ModelLimits,
  ModelCapabilities,
  ModelBilling,
  ModelPolicy,
  ModelSupportedEndpoint,
  Model,
  InteractionType,
  CopilotClientOptions,
  CopilotTokenInfo,
  DeviceFlowCodes,
  ToolHandler,
  SessionOptions,
} from "./types.js";
