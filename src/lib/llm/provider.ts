import type { z } from 'zod';

/**
 * A schema whose parsed OUTPUT is `T`. The input side is left open so
 * schemas with defaults or transforms (input ≠ output) are accepted.
 */
export type OutputSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/** Common configuration for any OpenAI-compatible LLM provider. */
export interface ProviderConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string; // text model
  visionModel: string; // vision-capable model
  /** Per-request timeout. Defaults to 60 s — vision calls with several photos are slow. */
  timeoutMs?: number;
  /**
   * OpenRouter only: models to fall back to, in order, when the primary is
   * rate-limited or down (sent as `models`). Leave empty for other providers,
   * which reject unknown request fields.
   */
  fallbackModels?: string[];
  visionFallbackModels?: string[];
  /** Wait before the single retry after HTTP 429 when there's no Retry-After. Default 2 s. */
  retryDelayMs?: number;
}

export interface TextRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ImageAttachment {
  mime: string; // e.g. "image/jpeg"
  dataBase64: string;
}

export interface VisionRequest<T> {
  system: string;
  user: string;
  images: ImageAttachment[];
  schema: OutputSchema<T>;
}

/**
 * LLM provider abstraction. Every provider (OpenAI, OpenRouter, Together,
 * Groq, local llama.cpp server) implements this. The app never imports a
 * vendor SDK directly — only this interface.
 */
export interface LLMProvider {
  /** Free-form text completion. Throws on transport or HTTP error. */
  completeText(req: TextRequest): Promise<string>;

  /**
   * JSON completion: the provider is asked to return JSON (we use the OpenAI
   * "json_object" response_format when supported, plus a fence-stripping
   * fallback for older providers). The result is parsed and validated against
   * the supplied Zod schema.
   */
  completeJSON<T>(req: { system: string; user: string; schema: OutputSchema<T> }): Promise<T>;

  /**
   * Vision completion. Images are sent as base64 data URLs in the user
   * message. Result is validated against the supplied Zod schema.
   */
  chatWithVision<T>(req: VisionRequest<T>): Promise<T>;
}
