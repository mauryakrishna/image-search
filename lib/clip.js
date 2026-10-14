import { env, pipeline } from "@huggingface/transformers";

export const MODEL = "Xenova/clip-vit-base-patch32";

// Vercel's filesystem is read-only except /tmp; locally the default cache (in node_modules) is kept.
if (process.env.VERCEL) env.cacheDir = "/tmp/transformers-cache";

// Loaded once per server process. q8 = 8-bit quantized weights: ~90 MB instead of ~340 MB,
// which keeps cold starts on Vercel short, at a small accuracy cost.
let extractor;
export function getExtractor() {
  return (extractor ??= pipeline("image-feature-extraction", MODEL, { dtype: "q8" }).catch((e) => {
    extractor = undefined; // retry on the next request instead of caching the failure
    throw e;
  }));
}
