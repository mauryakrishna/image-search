// Smoke check for /api/upload. Run with the dev server up:
//   node --env-file=.env.local check-upload.mjs
// Cleans up the rows and files it creates.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";

const URL = "http://localhost:3000/api/upload";
// 1x1 grayscale+alpha PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

async function post(blob, filename) {
  const body = new FormData();
  if (blob) body.append("image", blob, filename);
  return fetch(URL, { method: "POST", body });
}

const created = [];
try {
  const res1 = await post(new Blob([png], { type: "image/png" }), "../../evil.png");
  assert.equal(res1.status, 200);
  const first = await res1.json();
  created.push(first.name);
  assert.match(first.name, /^[0-9a-f-]{36}\.png$/);
  assert.ok(Array.isArray(first.similar));

  // Same image again: recognized as a duplicate, not stored twice, not listed as its own match.
  const again = await (await post(new Blob([png], { type: "image/png" }), "again.png")).json();
  assert.equal(again.duplicate, true);
  assert.equal(again.name, first.name);
  assert.ok(!again.similar.some((s) => s.name === first.name));

  // A similar but different image is stored and finds the original.
  const poster = (cx) =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200">
      <rect width="300" height="200" fill="#3b82f6"/><circle cx="${cx}" cy="100" r="60" fill="#facc15"/></svg>`))
      .png()
      .toBuffer();
  const a = await (await post(new Blob([await poster(150)], { type: "image/png" }), "a.png")).json();
  created.push(a.name);
  const b = await (await post(new Blob([await poster(110)], { type: "image/png" }), "b.png")).json();
  created.push(b.name);
  assert.equal(b.duplicate, false);
  const match = b.similar.find((s) => s.name === a.name);
  assert.ok(match && match.similarity < 0.9999, `expected ${a.name} in ${JSON.stringify(b.similar)}`);

  const served = await fetch(`http://localhost:3000/uploads/${first.name}`);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal((await fetch("http://localhost:3000/uploads/..%2F.env.local")).status, 404);

  assert.equal((await post(new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg")).status, 415);
  assert.equal((await post(new Blob(["hi"], { type: "text/plain" }), "x.txt")).status, 415);
  assert.equal((await post(new Blob(["not really a png"], { type: "image/png" }), "fake.png")).status, 422);
  assert.equal((await post(null)).status, 400);

  console.log("upload checks passed");
} finally {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query("DELETE FROM images WHERE filename = ANY($1)", [created]);
  await db.end();
  await Promise.all(created.map((n) => rm(`uploads/${n}`, { force: true })));
}
