export class CopilotAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotAuthError";
  }
}

export class CopilotApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(status: number, body: string) {
    super(`Copilot API error ${status}: ${body}`);
    this.name = "CopilotApiError";
    this.status = status;
    this.body = body;
  }
}

export class CopilotStreamError extends Error {
  constructor(message: string, public readonly raw?: string) {
    super(message);
    this.name = "CopilotStreamError";
  }
}
