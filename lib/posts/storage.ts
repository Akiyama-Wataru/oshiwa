/**
 * Kept out of the "use server" action module: every export of a server action
 * file must be an async function, so a plain constant there would break the
 * server reference registry at runtime.
 */
export const POST_IMAGE_BUCKET = "post-images";
