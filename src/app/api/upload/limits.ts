/** One photo, at most (the decoded upload, before it is re-encoded). */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** The whole multipart body: one photo plus the form's fields and boundaries. */
export const MAX_BODY_BYTES = MAX_PHOTO_BYTES + 1024 * 1024;
