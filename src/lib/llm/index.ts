/**
 * Re-exports for the LLM provider layer. The app should only ever import
 * from this module — never from a vendor SDK or specific implementation.
 */
export type { LLMProvider, ProviderConfig, TextRequest, ImageAttachment, VisionRequest } from './provider';
export { OpenAICompatibleProvider, LLMResponseError, LLMRequestError, LLMNotConfiguredError, providerFromEnv } from './openai-compatible';
export { extractRoom, ExtractionError, type ExtractRoomResult, type MeasurementInput } from './extract';
export { refinePlan, RefinementError, type RefineResult } from './refine';
export { refineCloset, type ClosetRefineResult } from './closet';
