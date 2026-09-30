/**
 * Prompt builders for LLM interactions. Each function returns `{ system, user }`
 * so callers can construct their provider request. Prompts are versioned via
 * the `PROMPT_VERSION` constant, which is embedded in the system prompt.
 */

import type { ReferenceObject } from '../plan/schemas';

export const PROMPT_VERSION = '1.2.0';

export interface ExtractPromptPhoto {
  /** 0-based position in the attached images. */
  index: number;
  /** Size of the image as SENT to the model (after downscaling). */
  width: number;
  height: number;
  wallHint?: 'north' | 'east' | 'south' | 'west' | 'unknown';
  /** Reference object with `pixelBox` already mapped to the sent image's pixels. */
  reference?: ReferenceObject;
}

export interface ExtractPromptInput {
  photos: ExtractPromptPhoto[];
  /** Tape-measured walls, described in the user's words. */
  measurements: Array<{ description: string; lengthMm: number }>;
  /** Optional free-form hint (e.g. "galley kitchen, the fridge is by the door"). */
  hint?: string;
}

/**
 * Build the prompt that asks the vision LLM for a room outline.
 *
 * Design rules (intentional):
 *  - Always millimetres, and the exact response shape.
 *  - Measured walls are the scale; the server rescales to them afterwards,
 *    so the model's job is mainly the SHAPE and PROPORTIONS, plus saying
 *    which edge each measurement belongs to.
 *  - Reference objects are only a secondary hint (a single photo's scale
 *    is valid only at the object's depth).
 *  - Uncertainty goes into `confidence` and `notes`, never silent guesses.
 */
export function buildExtractRoomPrompt(input: ExtractPromptInput): { system: string; user: string } {
  const system = [
    `You are a room-outline extractor for a kitchen design app. (prompt v${PROMPT_VERSION})`,
    '',
    'You will be given photos of one room. Produce the floor outline as seen from above, in millimetres, as a single JSON object.',
    '',
    'Scale:',
    '- The user tape-measured some walls. Those lengths are exact: use them as the scale. After you answer, the app rescales your outline so every measured wall matches its measurement, so getting the SHAPE and PROPORTIONS right matters most.',
    '- A reference object (credit card, sheet of paper, coin) may be boxed in some photos. It is only a secondary hint: its scale holds at its own distance from the camera, not across the room.',
    '',
    'Return this exact shape:',
    '{',
    '  "confidence": <number 0..1, how sure you are>,',
    '  "polygonMm": [[x0,y0], [x1,y1], ...],   // >= 3 vertices, tracing the perimeter',
    '  "walls": [{"thicknessMm": 120}, ...],   // exactly one per polygon edge',
    '  "openings": [{"wallIdx": k, "kind": "door"|"window"|"pass_through", "positionMm": <mm along wall>, "widthMm": <mm>, "heightMm": <mm>}, ...],',
    '  "measuredWalls": [k, ...],              // for each measurement, in order, the wall index it measures',
    '  "notes": "<free-form caveats, e.g. assumed depth, occluded corner>"',
    '}',
    '',
    'Rules:',
    '- All distances are in MILLIMETRES. Do not return inches.',
    '- polygonMm is closed implicitly: do not repeat the first vertex at the end.',
    '- walls[i] is the edge from polygonMm[i] to polygonMm[i+1] (the last wall closes back to vertex 0). Return exactly N walls for N vertices.',
    '- openings[].wallIdx references a wall index (0..N-1). positionMm is measured along the wall from its start vertex; positionMm + widthMm must not exceed the wall length.',
    '- measuredWalls[j] is the wall index (0..N-1) that measurement j describes. Use the descriptions and the photos to match them.',
    '- If you cannot see part of the room clearly, give your best guess, lower confidence, and say so in notes.',
    '- Return ONLY the JSON object. No prose, no markdown fences.',
  ].join('\n');

  const n = input.photos.length;
  const lines: string[] = [`Attached: ${n === 1 ? '1 photo' : `${n} photos`}, in this order.`];
  for (const p of input.photos) {
    let line = `- Photo ${p.index + 1} (${p.width}×${p.height} px)`;
    if (p.wallHint && p.wallHint !== 'unknown') line += `: faces the ${p.wallHint} wall`;
    if (p.reference) {
      const r = p.reference;
      line += `${p.wallHint && p.wallHint !== 'unknown' ? ';' : ':'} a ${r.kind} is boxed at [${r.pixelBox.join(', ')}] px; the box spans its ${r.side} edge, which is ${r.knownSizeMm} mm`;
    }
    lines.push(line);
  }

  lines.push('');
  if (input.measurements.length === 0) {
    lines.push('There are no measured walls: estimate sizes from the photos and typical kitchens, and lower your confidence. measuredWalls must be [].');
  } else {
    lines.push('Measured walls:');
    input.measurements.forEach((m, i) => lines.push(`- Measurement ${i + 1}: "${m.description}" = ${m.lengthMm} mm`));
    lines.push(`measuredWalls must have exactly ${input.measurements.length} entries, in the order above.`);
  }
  if (input.hint) lines.push('', `User hint: ${input.hint}`);

  return { system, user: lines.join('\n') };
}

export const REFINE_PROMPT_VERSION = '1.1.0';

export interface RefinePromptInput {
  /** From describePlanForLLM. */
  planText: string;
  /** From describeCatalogForLLM. */
  catalogText: string;
  message: string;
  /** Recent chat turns, oldest first. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Build the prompt that turns a chat request into plan-edit commands.
 * Design rules: the model names things only by refs from the plan text, uses
 * wall + alongMm for anything against a wall (the server does the geometry),
 * and says so in `reply` instead of guessing when a request is unclear.
 * Whole layouts use `addRun` (one per wall): the server packs each run
 * around doors, windows, corners, and existing items.
 */
export function buildRefinePrompt(input: RefinePromptInput): { system: string; user: string } {
  const system = [
    `You edit kitchen floor plans for a design app. (refine prompt v${REFINE_PROMPT_VERSION})`,
    '',
    'You receive the current plan and a request. Reply with ONE JSON object:',
    '{',
    '  "commands": [ ...zero or more commands, applied in order... ],',
    '  "summary": "<one short line describing the change, e.g. Move the fridge to the north wall>",',
    '  "reply": "<a short message to the user: what you did, or a question / why you could not>"',
    '}',
    '',
    'Commands (exact shapes):',
    '- {"type":"addItem","catalogId":"<catalog id>","wall":"w1","alongMm":1200}   // against a wall; alongMm = item centre measured from the wall start corner (omit for the middle)',
    '- {"type":"addItem","catalogId":"<catalog id>","x":1500,"y":2000,"rotationDeg":0}   // free-standing (islands, tables)',
    '- {"type":"addRun","wall":"w1","items":["<catalog id>","<catalog id>",...],"from":"start"|"end"|"centre"}   // a row of items along a wall, listed from its start corner to its end; the app packs them back to back, skipping doors (and windows, for wall cabinets and tall items) and keeping clear of other runs; "from" = which corner the row is pushed against (default start)',
    '- {"type":"moveItem","item":"i1","wall":"w2"}   // or add "alongMm", or use "x"/"y" instead of "wall"',
    '- {"type":"rotateItem","item":"i1","rotationDeg":90}   // absolute; 0 = front faces south',
    '- {"type":"removeItem","item":"i1"}',
    '- {"type":"addOpening","wall":"w3","kind":"door"|"window"|"pass_through","alongMm":1500,"widthMm":900}',
    '- {"type":"removeOpening","opening":"o1"}',
    '- {"type":"setWallThickness","wall":"w2","thicknessMm":150}',
    '- {"type":"renameProject","name":"..."}',
    '',
    'Rules:',
    '- Refer to walls, openings, and items ONLY by the refs in the plan (w1, o1, i1, ...). Use catalog ids ONLY from the catalog list.',
    '- For anything against a wall (cabinets, appliances, sinks), use "wall" (+ optional "alongMm"): the app places the item flush against that wall, facing into the room.',
    '- Match compass words ("north wall") and descriptions ("the fridge") to the refs using the plan text.',
    '- All distances are millimetres.',
    '- Do only what was asked. Do not add, move, or remove anything else.',
    '',
    'Layouts (e.g. "design an L-shaped kitchen"):',
    '- Use one addRun per wall: L-shape = two walls meeting at a corner, U-shape = three walls, galley = two opposite walls, one-wall = one. Prefer walls without doors.',
    '- Include a sink base, a range, a fridge, and a dishwasher (next to the sink) unless the user says otherwise; fill the rest of each run with base cabinets (base-…), leaving counter space (at least one base cabinet) beside the range and the sink.',
    '- Keep the sink, range, and fridge in a work triangle (each 1200–2700 mm apart). Put the sink under a window if there is one; never the range. Put the fridge at the end of a run, not in the middle.',
    '- Optionally add wall cabinets (wall-…) and a range hood with a second addRun on the same wall with the same "from" as the base run; they go above base cabinets automatically. Give them the same widths, in the same order, as the base run below (a hood of the same width as the range, in its place, nothing over the fridge) so the hood lands above the range.',
    '- A run must fit: add up its widths. Budget the wall length minus doors, minus about 600 mm for each corner a run on the neighbouring wall already uses (in an L, the second run loses 600 mm at the shared corner). Prefer fewer, wider cabinets and leave a little spare.',
    '- Islands and tables are free-standing: addItem with x/y, keeping about 1000 mm clear from the runs.',
    '- If the room already has items, keep them and design around them, unless the user asks to start over (then removeItem them first).',
    '',
    '- If the request is a question, unclear, or impossible with these commands, return "commands": [] and explain in "reply".',
    '- Return ONLY the JSON object. No prose, no markdown fences.',
  ].join('\n');

  const turns = (input.history ?? []).map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`);
  const user = [
    'Current plan:',
    input.planText,
    '',
    'Catalog (id: name, width × depth × height, mount):',
    input.catalogText,
    ...(turns.length ? ['', 'Recent conversation:', ...turns] : []),
    '',
    `Request: ${input.message}`,
  ].join('\n');

  return { system, user };
}
