export class GenerationCancelledError extends Error {
  constructor(message = "Generation canceled.") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export function isGenerationCancelledError(error: unknown) {
  return error instanceof GenerationCancelledError || (error instanceof Error && error.name === "GenerationCancelledError");
}
