import type {
  ModelProvider,
  ModelProviderError,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
} from "@cce/application";

export type FakeModelProviderStep =
  | {
      readonly operation: "generate";
      readonly outcome:
        | { readonly type: "response"; readonly response: ModelResponse }
        | { readonly type: "error"; readonly error: ModelProviderError };
    }
  | {
      readonly operation: "stream";
      readonly events: readonly ModelStreamEvent[];
      readonly terminalError?: ModelProviderError;
    };

type FakeGenerateStep = Extract<FakeModelProviderStep, { readonly operation: "generate" }>;
type FakeStreamStep = Extract<FakeModelProviderStep, { readonly operation: "stream" }>;

export class FakeModelProvider implements ModelProvider {
  readonly #steps: FakeModelProviderStep[];
  readonly #generateRequests: ModelRequest[] = [];
  readonly #streamRequests: ModelRequest[] = [];

  public constructor(steps: readonly FakeModelProviderStep[] = []) {
    this.#steps = [...steps];
  }

  public get generateRequests(): readonly ModelRequest[] {
    return [...this.#generateRequests];
  }

  public get streamRequests(): readonly ModelRequest[] {
    return [...this.#streamRequests];
  }

  public get remainingStepCount(): number {
    return this.#steps.length;
  }

  public async generate(request: ModelRequest): Promise<ModelResponse> {
    this.#generateRequests.push(request);
    const step = this.takeGenerateStep();
    if (step.outcome.type === "error") {
      throw step.outcome.error;
    }
    return Promise.resolve(step.outcome.response);
  }

  public async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.#streamRequests.push(request);
    const step = this.takeStreamStep();
    for (const event of step.events) {
      yield event;
    }
    if (step.terminalError !== undefined) {
      throw step.terminalError;
    }
  }

  public assertExhausted(): void {
    if (this.#steps.length !== 0) {
      throw new Error(`FakeModelProvider has ${this.#steps.length.toString()} unconsumed step(s).`);
    }
  }

  private takeGenerateStep(): FakeGenerateStep {
    const step = this.#steps.shift();
    if (step === undefined) {
      throw new Error("Unexpected generate call to FakeModelProvider.");
    }
    if (step.operation !== "generate") {
      throw new Error("Expected a stream call to FakeModelProvider, received generate.");
    }
    return step;
  }

  private takeStreamStep(): FakeStreamStep {
    const step = this.#steps.shift();
    if (step === undefined) {
      throw new Error("Unexpected stream call to FakeModelProvider.");
    }
    if (step.operation !== "stream") {
      throw new Error("Expected a generate call to FakeModelProvider, received stream.");
    }
    return step;
  }
}
