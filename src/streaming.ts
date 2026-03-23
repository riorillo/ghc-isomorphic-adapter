import { CopilotStreamError } from "./errors.js";
import type { ResponseEvent } from "./types.js";

/**
 * Parse a fetch Response as an SSE stream and yield typed ResponseEvent objects.
 */
export async function* parseSSEStream(
  response: Response,
): AsyncIterable<ResponseEvent> {
  const body = response.body;
  if (!body) {
    throw new CopilotStreamError("Response body is null");
  }

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;

      // SSE events are separated by double newlines
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = extractData(raw);
        if (data === null || data.startsWith("[DONE]")) continue;

        let event: ResponseEvent;
        try {
          event = JSON.parse(data) as ResponseEvent;
        } catch (err) {
          throw new CopilotStreamError(
            `Failed to parse SSE data: ${err instanceof Error ? err.message : String(err)}`,
            data,
          );
        }

        if (event.choices.length > 0) {
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Extract the concatenated `data:` field(s) from a single SSE event block. */
function extractData(raw: string): string | null {
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ")) {
      parts.push(line.slice(6));
    } else if (line.startsWith("data:")) {
      parts.push(line.slice(5));
    }
    // Ignore other SSE fields (event:, id:, retry:, comments)
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
