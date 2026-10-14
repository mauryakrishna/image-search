import { RawImage } from "@huggingface/transformers";
import { getExtractor } from "../../../lib/clip.js";

export const dynamic = "force-dynamic"; // never run at build time

// The page calls this on load so the model is ready before the first upload.
// Runs one tiny inference, so it also works as a health check for the model.
export async function GET() {
  const start = Date.now();
  const out = await (await getExtractor())(new RawImage(new Uint8ClampedArray(3), 1, 1, 3));
  return Response.json({ ok: true, dims: out.dims, ms: Date.now() - start });
}
