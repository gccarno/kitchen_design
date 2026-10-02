# Testing guide — Kitchen Design App v1

Two parts: the automated checks (about 5 minutes, no judgement needed) and a manual walkthrough of the real app (about 30 minutes). Do the automated checks first; if they fail, fix that before testing by hand.

## 0. Setup

```bash
npm install
cp .env.example .env.local     # skip if .env.local already exists
npm run dev                    # http://localhost:3000
```

- **LLM key (needed for sections 3 and 5 only).** In `.env.local` set `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_VISION_MODEL`. Free OpenRouter models work but can be slow or rate-limited; see `.env.example`. Everything else works with no key.
- **Fresh data.** Projects live in `./data/projects`. Delete that folder for a clean slate.
- **Phone testing.** Phones need HTTPS (or localhost) to install the PWA. Easiest: a tunnel such as `npx localtunnel --port 3000` or `ngrok http 3000`. Camera upload works over plain LAN HTTP; installing does not.

## 1. Automated checks

| Command | Expect |
|---|---|
| `npm run lint` | no warnings or errors |
| `npm run typecheck` | no output |
| `npm test` | 55 files / 582 tests pass (includes a live dev-server suite against a fake LLM) |
| `npm run e2e` | 31 Playwright tests pass (~2 min; own port 3310 and a temp data dir, so it never touches `./data`) |

The whole journey is `tests/e2e/happy-path.spec.ts` (photo → measured wall → extract → apply → place cabinet → export SVG, with the LLM mocked).

## 2. Projects and the home page (no LLM)

1. Open `/`. Create a project called "Test kitchen". You land on `/project/<id>` showing **Revision 0** and a default 3000 × 4000 mm room.
2. Go back to `/`. The card shows a thumbnail, name, revision and date.
3. **Rename** the card to "Test kitchen 2". Open it: **Revision 1**; history says "Rename to …". Undo (section 6) brings the old name back.
4. Create a second project and **Delete** it from the list: it asks first, then disappears; reload and it's still gone.
5. Reload `/`: newest project first, thumbnails still render.

## 3. Room from photos (needs an LLM key)

1. In a project, upload 1–4 kitchen photos (on a phone: use the camera). Each appears with a "mark the reference object" view.
2. Optional: drag a box around a credit card in a photo and pick its edge. "Saved" appears.
3. In the extraction panel enter one measured wall: a description (e.g. "sink wall") and its tape-measured length in mm. Click **Get room from photos**. Wait up to a minute (longer on free models).
4. A **Review proposed change** panel appears: current vs proposed plan, model confidence, notes, change list. **Nothing is saved yet** — reload to confirm the revision hasn't changed.
5. Click **Apply**. Revision goes up by one.
6. **Check:** the wall you measured is exactly the length you typed (see the wall labels on the canvas), not approximately.
7. Run another extraction and click **Discard**: nothing changes.
8. With no photos uploaded the button is disabled and asks for a photo.
9. With `LLM_API_KEY` empty (restart the server): extraction says the key isn't set and that you can still sketch by hand, with no crash.

## 4. Sketch a room by hand (no LLM)

1. In the sketch panel enter Width 3600 and Depth 2700, **Use rectangle**, then **Save room**.
2. The review panel shows `3000 × 4000 mm → 3600 × 2700 mm`. **Apply**. Reload: the new size persists.
3. Type a measured length into a wall's "measured mm" box; the sketch rescales to match exactly.

## 5. Chat edits and layouts (needs an LLM key)

1. Ask **"add a dishwasher on the north wall"** and press Enter. A diff describes the new item and the chat shows a reply. Apply; reload: it's still there.
2. Place a fridge (section 7), then ask **"move the fridge to the north wall"**. The diff shows a move; Apply; reload.
3. Ask for a whole layout: **"design an L-shaped kitchen with the fridge near the sink"**. Expect several items in one diff, a long wait on free models, and warnings if clearances break. Review before applying; Discard also works.
4. Ask for something impossible ("add a spaceship"). Expect a polite failure, not a crash or a half-applied change.
5. With no key: chat says edits still work by hand.

## 6. Outline, doors, windows, undo (no LLM)

1. Click **Edit outline**. Drag a corner; walls and labels follow. Tap a wall's **+** to add a corner. Delete removes the selected corner.
2. **Add door / window / pass-through**, then tap a wall. Drag the end squares to resize, drag the body to slide. Putting one on another opening or off a wall is refused.
3. **Done editing**. Every change is a new revision.
4. **Undo / Redo** buttons, **Ctrl+Z**, **Ctrl+Shift+Z / Ctrl+Y** (ignored while typing in a field). Reload and undo still works. The history list shows the last 20 revisions.
5. Make an edit after an undo: redo is cleared.

## 7. Place items (no LLM)

1. Pick **Base cabinet 600 mm** in the catalog and tap near a wall: it snaps back-to-wall facing into the room. Try the catalog search ("fridge", "island").
2. Drag it along the wall; it stays flush. **Rotate 90°**, **Remove item**.
3. Place a **Wall cabinet 600 mm** over the base cabinet: allowed, no overlap warning. Tap the stack again to cycle between the two.
4. A wall cabinet mid-room, or any item outside the room: refused with a reason.
5. Fridge on the north wall plus an island about 600 mm in front of it: a **Heads up** clearance warning appears under the canvas.
6. Put an item in a door's swing: expect a door-swing warning.
7. **Cancel** while placing: nothing is added.

## 8. Export

1. Header links: **SVG**, **PNG**, **PNG (2×)**.
2. Open the SVG in a browser: black mitred walls, door arcs, window lines, labelled items, a dimension on every wall, a scale bar, a north arrow, a title block (name, scale, revision, date).
3. The PNG opens in an image viewer; the 2× file is twice the width of the 1×, white background.
4. File names are the project name, with `@2x` on the large PNG.

## 9. Phone and PWA

1. Open the HTTPS/tunnel URL on a phone. The layout fits with no sideways scrolling.
2. Take photos with the camera in section 3.
3. Browser menu → **Add to Home Screen / Install**. It opens full-screen with the app icon.
4. Expect **no offline mode**: with the server off it won't load. That's by design in v1.

## 10. Robustness

- Open the same project in two tabs, edit in one, then the other: the second reports that the plan changed instead of overwriting.
- Open `/project/00000000-0000-0000-0000-000000000000`: a not-found state, not a crash.
- Reload mid-edit: nothing is lost except an unapplied proposal.

## Known limits (not bugs)

- No offline use, multi-user sync or accounts (single user, local files).
- Room extraction from photos is approximate; the measured wall is the only scale source of truth.
- Free LLM models are slow and sometimes return invalid output; the app retries once, then shows the error.
- Deleting a project is permanent.

## Report template

```
Section / step:
What I did:
Expected:
Actual:
Browser / device:
Project id (from the URL):
```
