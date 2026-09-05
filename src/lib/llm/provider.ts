import type { z } from 'zod';

/** Common configuration for any OpenAI-compatible LLM provider. */
export interface ProviderConfig {
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey: string;
  model: string; // text model
  visionModel: string; // vision-capable model
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
  schema: z.ZodType<T>;
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
  completeJSON<T>(req: { system: string; user: string; schema: z.ZodType<T> }): Promise<T>;

  /**
   * Vision completion. Images are sent as base64 data URLs in the user
   * message. Result is validated against the supplied Zod schema.
   */
  chatWithVision<T>(req: VisionRequest<T>): Promise<T>;
}
