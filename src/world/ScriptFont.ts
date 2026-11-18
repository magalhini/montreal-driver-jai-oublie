/**
 * The brush script for names written in cursive (the Tim Hortons boards and neon). Yellowtail, free under
 * Apache 2.0, bundled in `public/fonts`. Canvas text drawn before it loads falls back to the system script.
 */
export const SCRIPT = '"Yellowtail", "Brush Script MT", cursive';

let ready: Promise<boolean> | null = null;

/** Starts the load once. Resolves true when the font is in, false if it failed (already warned). */
export function scriptFontReady(): Promise<boolean> {
  if (!ready) {
    const face = new FontFace('Yellowtail', `url(${import.meta.env.BASE_URL}fonts/Yellowtail-Regular.ttf)`);
    document.fonts.add(face);
    ready = face.load().then(
      () => true,
      (err) => {
        console.warn('Script font failed to load', err);
        return false;
      },
    );
  }
  return ready;
}
