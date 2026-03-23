import type { CopilotChatClient } from "./client.js";
import type {
  AssistantMessage,
  ChatMessage,
  InteractionType,
  ResponseDelta,
  ResponseEvent,
  SessionOptions,
  ToolCall,
  ToolCallChunk,
} from "./types.js";

const DEFAULT_MAX_TOOL_ROUNDS = 10;

/**
 * A chat session that maintains conversation history and
 * optionally handles tool-call loops automatically.
 */
export class ChatSession {
  private messages: ChatMessage[] = [];
  private readonly client: CopilotChatClient;
  private readonly options: SessionOptions;

  constructor(client: CopilotChatClient, options: SessionOptions) {
    this.client = client;
    this.options = options;

    if (options.systemPrompt) {
      this.messages.push({
        role: "system",
        content: options.systemPrompt,
      });
    }
  }

  /** Get a snapshot of the current conversation messages. */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Manually add a user message to history. */
  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
  }

  /** Manually add an assistant message to history. */
  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    const msg: AssistantMessage = { role: "assistant", content };
    if (toolCalls?.length) msg.tool_calls = toolCalls;
    this.messages.push(msg);
  }

  /** Manually add a tool result message. */
  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", content, tool_call_id: toolCallId });
  }

  /** Clear conversation history (optionally preserving the system prompt). */
  clear(keepSystemPrompt = true): void {
    if (keepSystemPrompt && this.options.systemPrompt) {
      this.messages = [{ role: "system", content: this.options.systemPrompt }];
    } else {
      this.messages = [];
    }
  }

  /**
   * Send a user message and get a complete response.
   * Handles tool-call loops automatically if tool handlers are provided.
   */
  async send(
    content: string,
    options?: { interactionType?: InteractionType },
  ): Promise<string> {
    this.addUserMessage(content);

    const maxRounds =
      this.options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    for (let round = 0; round < maxRounds; round++) {
      const response = await this.client.complete(
        {
          model: this.options.model,
          messages: this.messages,
          tools: this.options.tools,
          temperature: this.options.temperature,
        },
        {
          isUserInitiated: true,
          interactionType: options?.interactionType,
        },
      );

      const choice = response.choices[0];
      const message = choice?.message;
      if (!message) break;

      const assistantContent = message.content ?? "";
      const toolCalls = assembleToolCalls(message.tool_calls);

      this.addAssistantMessage(assistantContent, toolCalls);

      if (!toolCalls.length || !this.options.toolHandlers) {
        return assistantContent;
      }

      // Execute tool calls
      await this.executeToolCalls(toolCalls);
    }

    // Return last assistant message content
    const lastAssistant = [...this.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return (lastAssistant as AssistantMessage)?.content as string ?? "";
  }

  /**
   * Send a user message and stream the response.
   * Handles tool-call loops automatically if tool handlers are provided.
   * Yields text content chunks.
   */
  async *sendStream(
    content: string,
    options?: { interactionType?: InteractionType },
  ): AsyncGenerator<string> {
    this.addUserMessage(content);

    const maxRounds =
      this.options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    for (let round = 0; round < maxRounds; round++) {
      let fullContent = "";
      const toolCallAccumulator: Map<
        number,
        { id: string; name: string; arguments: string; thought_signature?: string }
      > = new Map();
      let finishReason: string | null = null;

      for await (const event of this.client.stream(
        {
          model: this.options.model,
          messages: this.messages,
          tools: this.options.tools,
          temperature: this.options.temperature,
        },
        {
          isUserInitiated: true,
          interactionType: options?.interactionType,
        },
      )) {
        const choice = event.choices[0];
        if (!choice?.delta) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        // Yield text content
        if (choice.delta.content) {
          fullContent += choice.delta.content;
          yield choice.delta.content;
        }

        // Accumulate tool call chunks
        if (choice.delta.tool_calls) {
          accumulateToolCallChunks(toolCallAccumulator, choice.delta.tool_calls);
        }
      }

      // Build final tool calls
      const toolCalls = buildToolCallsFromAccumulator(toolCallAccumulator);

      this.addAssistantMessage(fullContent, toolCalls);

      if (
        finishReason !== "tool_calls" ||
        !toolCalls.length ||
        !this.options.toolHandlers
      ) {
        return;
      }

      // Execute tool calls and continue the loop
      await this.executeToolCalls(toolCalls);
    }
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    for (const tc of toolCalls) {
      const handler = this.options.toolHandlers?.[tc.function.name];
      if (!handler) {
        this.addToolResult(
          tc.id,
          JSON.stringify({ error: `No handler for tool: ${tc.function.name}` }),
        );
        continue;
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      try {
        const result = await handler(args);
        this.addToolResult(tc.id, result);
      } catch (err) {
        this.addToolResult(
          tc.id,
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }
}

// ── Helpers for streaming tool call assembly ──────────────────────

function accumulateToolCallChunks(
  acc: Map<number, { id: string; name: string; arguments: string; thought_signature?: string }>,
  chunks: ToolCallChunk[],
): void {
  for (const chunk of chunks) {
    const idx = chunk.index ?? 0;
    if (!acc.has(idx)) {
      acc.set(idx, { id: "", name: "", arguments: "" });
    }
    const entry = acc.get(idx)!;
    if (chunk.id) entry.id = chunk.id;
    if (chunk.function?.name) entry.name += chunk.function.name;
    if (chunk.function?.arguments) entry.arguments += chunk.function.arguments;
    if (chunk.function?.thought_signature) {
      entry.thought_signature = chunk.function.thought_signature;
    }
  }
}

function buildToolCallsFromAccumulator(
  acc: Map<number, { id: string; name: string; arguments: string; thought_signature?: string }>,
): ToolCall[] {
  return Array.from(acc.values())
    .filter((entry) => entry.id && entry.name)
    .map((entry) => ({
      id: entry.id,
      type: "function" as const,
      function: {
        name: entry.name,
        arguments: entry.arguments,
        ...(entry.thought_signature ? { thought_signature: entry.thought_signature } : {}),
      },
    }));
}

function assembleToolCalls(
  chunks?: ToolCallChunk[],
): ToolCall[] {
  if (!chunks?.length) return [];
  const acc = new Map<
    number,
    { id: string; name: string; arguments: string; thought_signature?: string }
  >();
  accumulateToolCallChunks(acc, chunks);
  return buildToolCallsFromAccumulator(acc);
}
