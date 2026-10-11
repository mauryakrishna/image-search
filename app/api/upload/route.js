import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pipeline, RawImage } from "@huggingface/transformers";
import { Pool } from "pg";
import sharp from "sharp";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set; add it to .env.local");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_RESULTS = 5;
// ponytail: eyeballed cutoff for CLIP image-to-image (unrelated photos often score 0.5-0.7); tune on real images
const MIN_SIMILARITY = 0.8;
// Identical images score 1.0; the margin only absorbs float rounding.
const SAME_IMAGE = 0.9999;
const MAX_BYTES = 10 * 1024 * 1024;
// No SVG: it can carry scripts.
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MODEL = "Xenova/clip-vit-base-patch32";

// Loaded once per server process; the model downloads on first use and is cached.
let extractor;
function getExtractor() {
  return (extractor ??= pipeline("image-feature-extraction", MODEL).catch((e) => {
    extractor = undefined; // retry on the next request instead of caching the failure
    throw e;
  }));
}

export async function POST(req) {
  // ponytail: whole body is buffered before the size check; stream it (e.g. busboy) if this is ever exposed publicly
  const file = (await req.formData()).get("image");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No image provided" }, { status: 400 });
  }
  const ext = EXT[file.type];
  if (!ext) {
    return Response.json({ error: "Only JPEG, PNG, WebP or GIF images are allowed" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image is larger than 10 MB" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Decode to plain RGB ourselves: CLIP wants 3 channels, and RawImage.fromBlob throws on
  // grayscale+alpha PNGs. Decoding also doubles as a content check: renamed non-images fail here.
  let image;
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .flatten({ background: "#fff" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    image = new RawImage(data, info.width, info.height, info.channels);
  } catch {
    return Response.json({ error: "File is not a readable image" }, { status: 422 });
  }
  const embedding = await (await getExtractor())(image);
  const vector = `[${embedding.data.join(",")}]`; // pgvector's text format

  // <=> is cosine distance, so similarity = 1 - distance (1 = identical direction).
  // One extra row in case the top hit is this very image, already stored.
  const { rows } = await pool.query(
    `SELECT filename AS name, 1 - (embedding <=> $1::vector) AS similarity
     FROM images ORDER BY embedding <=> $1::vector LIMIT $2`,
    [vector, MAX_RESULTS + 1]
  );

  // Same pixels as an existing upload: reuse it instead of storing a second copy.
  // ponytail: check-then-insert race on simultaneous identical uploads; add a UNIQUE content-hash column if that matters
  let name = rows[0]?.similarity >= SAME_IMAGE ? rows[0].name : null;
  const duplicate = Boolean(name);
  if (!duplicate) {
    // Server-generated name: never trust the client's filename (path traversal, collisions).
    name = `${randomUUID()}.${ext}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, name), buffer);
    await pool.query("INSERT INTO images (filename, embedding) VALUES ($1, $2)", [name, vector]);
  }

  const similar = rows
    .filter((r) => r.name !== name && r.similarity >= MIN_SIMILARITY)
    .slice(0, MAX_RESULTS);
  return Response.json({ name, duplicate, similar });
}
