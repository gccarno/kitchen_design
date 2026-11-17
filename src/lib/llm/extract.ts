/**
 * Photos → candidate room, via the vision LLM. Never mutates the project:
 * the result carries a JSON Patch against `baseRevision` that the client
 * shows in the diff preview and, on confirm, commits through the
 * revisions endpoint.
 */

import { newId } from '../id';
import { planToJsonPatch } from '../plan/diff';
import { rescaleRoomToMeasurements, SCALE_DISAGREEMENT_WARN } from '../plan/scale';
import type { JsonPatchOp, Photo, Project, Room } from '../plan/schemas';
import { validatePlan } from '../plan/validate';
import { prepareVisionImage } from './images';
import { LLMResponseError } from './openai-compatible';
import { buildExtractRoomPrompt, type ExtractPromptPhoto } from './prompts';
import type { ImageAttachment, LLMProvider } from './provider';
import { ExtractedRoomSchema, refineExtractedRoom, type ExtractedRoom } from './schemas';

export interface MeasurementInput {
  /** The user's words for which wall this is, e.g. "sink wall". */
  description: string;
  lengthMm: number;
}

export interface ExtractRoomInput {
  project: Project;
  readPhoto: (photo: Photo) => Promise<Buffer>;
  provider: LLMProvider;
  measurements: MeasurementInput[];
  hint?: string;
}

export interface ExtractRoomResult {
  room: Room;
  confidence: number;
  notes: string;
  /** Uniform factor applied to the model's outline to honour the measurements. */
  scale: number;
  residual: number;
  /** Things the user should see before confirming. */
  warnings: string[];
  baseRevision: number;
  /** Replaces the project's room with `room`; commit via the revisions endpoint. */
  patch: JsonPatchOp[];
}

/** The model failed to produce a usable room, even after one retry. */
export class ExtractionError extends Error {
  constructor(readonly issues: string[]) {
    super(`the model could not produce a valid room outline: ${issues.join('; ')}`);
    this.name = 'ExtractionError';
  }
}

const MAX_ATTEMPTS = 2;

export async function extractRoom(input: ExtractRoomInput): Promise<ExtractRoomResult> {
  const { project, provider, measurements } = input;
  if (project.photos.length === 0) throw new Error('project has no photos to extract from');

  const images: ImageAttachment[] = [];
  const promptPhotos: ExtractPromptPhoto[] = [];
  for (const [index, photo] of project.photos.entries()) {
    const vision = await prepareVisionImage(await input.readPhoto(photo));
    images.push(vision.image);
    const ref = photo.referenceObject;
    promptPhotos.push({
      index,
      width: vision.width,
      height: vision.height,
      wallHint: photo.wallHint,
      label: photo.label,
      reference: ref && {
        ...ref,
        pixelBox: ref.pixelBox.map((v) => Math.round(v * vision.scale)) as [number, number, number, number],
      },
    });
  }

  const prompt = buildExtractRoomPrompt({ photos: promptPhotos, measurements, hint: input.hint });
  const extracted = await askWithOneRetry(provider, prompt, images, measurements.length);

  const candidate = toRoom(extracted, measurements);
  const { room, scale, residual } = rescaleRoomToMeasurements(candidate);

  const warnings: string[] = [];
  if (measurements.length === 0) {
    warnings.push('No measured walls: all sizes are the model’s estimate. After applying, confirm one real size in the Room step.');
  } else if (residual > SCALE_DISAGREEMENT_WARN) {
    warnings.push(
      `Your measurements disagree with the outline’s proportions by ${Math.round(residual * 100)}%. Check the measurements or adjust the shape.`
    );
  } else if (measuredInOneDirectionOnly(extracted)) {
    warnings.push(
      'You measured walls running in one direction only, so the room’s size the other way is the model’s estimate. Measure a wall that meets one of them at a corner to pin it down.'
    );
  }
  const next: Project = { ...project, room };
  const check = validatePlan(next);
  warnings.push(...check.errors.map((e) => `Can’t apply as-is: ${e}`), ...check.warnings);

  return {
    room,
    confidence: extracted.confidence,
    notes: extracted.notes,
    scale,
    residual,
    warnings,
    baseRevision: project.revision,
    patch: planToJsonPatch(project, next),
  };
}

/** Walls within this angle of each other count as running the same way. */
const SAME_DIRECTION_DEG = 20;

/**
 * True when every measured wall runs the same way (one wall, or walls facing each other).
 * Rescaling makes those exact, but nothing then checks the room's size across them: models
 * have answered a "typical" depth there, at high confidence, whatever the photos showed.
 */
function measuredInOneDirectionOnly(ex: ExtractedRoom): boolean {
  const poly = ex.polygonMm;
  const directions = ex.measuredWalls.map((w) => {
    const [a, b] = [poly[w], poly[(w + 1) % poly.length]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  });
  const limit = Math.sin((SAME_DIRECTION_DEG * Math.PI) / 180);
  return directions.length > 0 && directions.every((d) => Math.abs(d[0] * directions[0][1] - d[1] * directions[0][0]) < limit);
}

async function askWithOneRetry(
  provider: LLMProvider,
  prompt: { system: string; user: string },
  images: ImageAttachment[],
  measurementCount: number
): Promise<ExtractedRoom> {
  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user =
      issues.length === 0
        ? prompt.user
        : `${prompt.user}\n\nYour previous answer was rejected:\n${issues.map((i) => `- ${i}`).join('\n')}\nReturn a corrected JSON object.`;
    try {
      const answer = await provider.chatWithVision({ system: prompt.system, user, images, schema: ExtractedRoomSchema });
      const refined = refineExtractedRoom(answer, { measurementCount });
      if (refined.ok) return refined.value;
      issues = refined.issues;
    } catch (err) {
      // Only a malformed answer is worth retrying; transport/HTTP errors propagate.
      if (!(err instanceof LLMResponseError)) throw err;
      issues = [err.message];
    }
  }
  throw new ExtractionError(issues);
}

/** Give walls and openings stable ids and attach measurements to their walls. */
function toRoom(ex: ExtractedRoom, measurements: MeasurementInput[]): Room {
  const walls = ex.walls.map((w) => ({ id: newId(), thicknessMm: w.thicknessMm }));
  const room: Room = {
    polygon: ex.polygonMm,
    walls,
    openings: ex.openings.map((o) => ({
      id: newId(),
      wallId: walls[o.wallIdx].id,
      kind: o.kind,
      positionMm: o.positionMm,
      widthMm: o.widthMm,
      heightMm: o.heightMm,
    })),
  };
  // Nothing was measured, so the scale is only the model's guess; confirming a real size clears this.
  if (measurements.length === 0) room.sizeEstimated = true;
  if (measurements.length > 0) {
    room.measurements = measurements.map((m, j) => ({
      wallId: walls[ex.measuredWalls[j]].id,
      lengthMm: m.lengthMm,
      source: 'user' as const,
    }));
  }
  return room;
}
