/**
 * Prompt builders for LLM interactions. Each function returns `{ system, user }`
 * so callers can construct their provider request. Prompts are versioned via
 * the file path (this directory) and as the `PROMPT_VERSION` constant.
 */

import type { ReferenceObjectKind } from '../plan/schemas';

export const PROMPT_VERSION = '1.0.0';

export interface ExtractPromptInput {
  units: 'mm' | 'in';
  photoCount: number;
  reference?: {
    kind: ReferenceObjectKind;
    /** Physical size in millimetres of the side the user marked. */
    knownSizeMm: number;
    side: 'short' | 'long';
  };
  /** Optional free-form hint the user can provide (e.g. "this is the kitchen"). */
  hint?: string;
}

/**
 * Build the prompt that asks the vision LLM to extract a room outline
 * from one or more photos that include a known-size reference object.
 *
 * Design rules (intentional):
 *  - Be explicit about the units (always mm) and the response shape.
 *  - Tell the model the EXACT known size so it can compute scale.
 *  - Tell the model how to handle uncertainty: set confidence, leave notes.
 *  - Demand `response_format: json_object` by instructing it to return JSON.
 */
export function buildExtractRoomPrompt(input: ExtractPromptInput): {
  system: string;
  user: string;
} {
  const refLine = input.reference
    ? `A reference object is visible in one of the photos: a "${input.reference.kind}". The user drew a rectangle around its ${input.reference.side} side, which is ${input.reference.knownSizeMm} mm in real life. Use that to compute the millimetre-per-pixel scale for the whole image.`
    : 'No reference object is present. Estimate dimensions based on typical room sizes, but lower your confidence accordingly.';

  const system = [
    `You are a room-outline extractor for a kitchen design app. (prompt v${PROMPT_VERSION})`,
    '',
    'You will be given one or more photos of a room. The user has placed a known-size reference object (a credit card, sheet of paper, etc.) in at least one photo and drawn a rectangle around one of its sides. Use that to derive a millimetre-per-pixel scale.',
    '',
    refLine,
    '',
    'Your job: produce a single JSON object with the room outline in millimetres, plan coordinates (looking down at the floor). Vertex order should trace the room perimeter.',
    '',
    'Return this exact shape:',
    '{',
    '  "confidence": <number 0..1, how sure you are>,',
    '  "polygonMm": [[x0,y0], [x1,y1], ...],   // >= 3 vertices, counter-clockwise',
    '  "walls": [{"fromIdx": i, "toIdx": j, "thicknessMm": 120}, ...],',
    '  "openings": [{"wallIdx": k, "kind": "door"|"window"|"pass_through", "positionMm": <mm along wall>, "widthMm": <mm>, "heightMm": <mm>}, ...],',
    '  "notes": "<free-form caveats, e.g. assumed ceiling height, occluded corner>"',
    '}',
    '',
    'Rules:',
    '- All distances are in MILLIMETRES. Do not return inches.',
    '- polygonMm is a closed polygon. The first vertex need not equal the last; close it implicitly.',
    '- walls[].fromIdx and walls[].toIdx reference polygonMm vertex indices (0..N-1). Every wall must have both endpoints in the polygon.',
    '- openings[].wallIdx references a wall index (0..W-1), not a polygon vertex.',
    '- Estimate generously but flag uncertainty. If you cannot see a wall clearly, return fewer walls and lower confidence.',
    '- Return ONLY the JSON object. No prose, no markdown fences.',
  ].join('\n');

  const photoLine =
    input.photoCount === 1 ? '1 photo' : `${input.photoCount} photos`;
  const hintLine = input.hint ? `\nUser hint: ${input.hint}` : '';
  const user = `Please extract the room outline from the attached ${photoLine}.${hintLine}`;

  return { system, user };
}
