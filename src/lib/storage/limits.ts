/** Photos a project may have: each one goes to the vision model on every extraction. Pure, so the browser can import it. */
export const MAX_PHOTOS = 8;
/**
 * Long-edge cap for stored photos. Phone photos are 4000+ px and several MB; the editor shows them
 * as thumbnails, the vision model gets 1568 px (llm/images.ts), and the offline cache keeps up to
 * 300 of them. This leaves room to zoom while marking a reference object. The browser shrinks to
 * this before uploading (client/shrink-photo.ts); the server does it again for anything that didn't.
 */
export const STORED_MAX_EDGE_PX = 2560;
/** A photo's label: the user's few words for what it shows ("sink wall"). */
export const MAX_PHOTO_LABEL = 60;
/** The one small width the photo route offers (`?w=`), for the photo grid and the review strip. */
export const THUMBNAIL_WIDTH_PX = 320;
