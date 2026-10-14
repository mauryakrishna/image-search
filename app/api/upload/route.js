import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { RawImage } from "@huggingface/transformers";
import { Pool } from "pg";
import sharp from "sharp";
import { getExtractor } from "../../../lib/clip.js";

// Checked per request, not at import: `next build` loads this file and must not need the DB secret.
let pool;
function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local locally, Environment Variables on Vercel)");
  return (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const BUCKET = "images";
// Vercel's disk is read-only, so there images go to Supabase Storage (SUPABASE_URL set);
// locally they go to uploads/ and are served by app/uploads/[name]/route.js.
const supabaseUrl = () => process.env.SUPABASE_URL?.replace(/\/+$/, "");

async function saveImage(name, buffer, type) {
  const base = supabaseUrl();
  if (!base) {
    if (process.env.VERCEL) throw new Error("SUPABASE_URL is not set; Vercel can't keep images on its disk");
    await mkdir(UPLOAD_DIR, { recursive: true });
    return writeFile(path.join(UPLOAD_DIR, name), buffer);
  }
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is not set");
  // Secret keys (sb_secret_...) go in the apikey header; they aren't JWTs, so not in Authorization.
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${name}`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, "Content-Type": type },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Supabase Storage upload failed: ${res.status} ${await res.text()}`);
}

function imageUrl(name) {
  const base = supabaseUrl();
  return base ? `${base}/storage/v1/object/public/${BUCKET}/${name}` : `/uploads/${name}`;
}
const MAX_RESULTS = 5;
// ponytail: eyeballed cutoff for CLIP image-to-image (unrelated photos often score 0.5-0.7); tune on real images
const MIN_SIMILARITY = 0.8;
// Identical images score 1.0; the margin only absorbs float rounding.
const SAME_IMAGE = 0.9999;
// Vercel rejects request bodies over 4.5 MB before they reach this code; stay under it.
const MAX_BYTES = 4 * 1024 * 1024;
// No SVG: it can carry scripts.
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function POST(req) {
  const file = (await req.formData()).get("image");
  if (!file || typeof file === "string") {
    return Response.json({ error: "No image provided" }, { status: 400 });
  }
  const ext = EXT[file.type];
  if (!ext) {
    return Response.json({ error: "Only JPEG, PNG, WebP or GIF images are allowed" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image is larger than 4 MB" }, { status: 413 });
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
  const { rows } = await db().query(
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
    await saveImage(name, buffer, file.type);
    await db().query("INSERT INTO images (filename, embedding) VALUES ($1, $2)", [name, vector]);
  }

  const similar = rows
    .filter((r) => r.name !== name && r.similarity >= MIN_SIMILARITY)
    .slice(0, MAX_RESULTS)
    .map((r) => ({ ...r, url: imageUrl(r.name) }));
  return Response.json({ name, url: imageUrl(name), duplicate, similar });
}
