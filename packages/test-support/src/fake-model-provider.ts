import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
} from "@cce/application";

export class ScriptedModelProvider implements ModelProvider {
  public readonly requests: ModelRequest[] = [];
  private readonly responses: (ModelResponse | Error)[] = [];
  private readonly streams: (readonly ModelStreamEvent[] | Error)[] = [];

  public enqueueResponse(response: ModelResponse | Error): void {
    this.responses.push(response);
  }

  public enqueueStream(stream: readonly ModelStreamEvent[] | Error): void {
    this.streams.push(stream);
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("No scripted model response is available.");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }

  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const stream = this.streams.shift();
    if (stream === undefined) {
      throw new Error("No scripted model stream is available.");
    }
    if (stream instanceof Error) {
      throw stream;
    }
    for (const event of stream) {
      yield event;
    }
  }
}

