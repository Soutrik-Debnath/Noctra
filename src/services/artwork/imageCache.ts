/**
 * One shared image decode cache for the artwork pipeline.
 *
 * The blur pass and the palette pass both need the same cover decoded. Loading it twice means two
 * full reads of a 500KB file through the custom protocol for every track change, competing with
 * the audio stream for the same disk. Decoding once and handing out the same element fixes that.
 *
 * `crossOrigin` is set because artwork arrives from the `noctra-audio://` host, and reading pixels
 * out of a canvas requires the image to have been fetched in CORS-clean mode.
 */
const cache = new Map<string, HTMLImageElement>();
const inFlight = new Map<string, Promise<HTMLImageElement>>();

export function loadArtwork(src: string): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(src);
  if (pending) return pending;

  const job = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load artwork: ${src}`));
    img.src = src;
  })
    .then((img) => {
      cache.set(src, img);
      return img;
    })
    .finally(() => inFlight.delete(src));

  inFlight.set(src, job);
  return job;
}
