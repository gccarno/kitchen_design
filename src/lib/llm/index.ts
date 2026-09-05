/**
 * Re-exports for the LLM provider layer. The app should only ever import
 * from this module — never from a vendor SDK or specific implementation.
 */
export type { LLMProvider, ProviderConfig, TextRequest, ImageAttachment, VisionRequest } from './provider';
export { OpenAICompatibleProvider, providerFromEnv } from './openai-compatible';
