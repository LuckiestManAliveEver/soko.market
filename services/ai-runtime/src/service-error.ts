export class InferenceServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "InferenceServiceError";
  }
}
