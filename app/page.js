"use client";

import { useEffect, useState } from "react";

export default function Home() {
  // Start loading the model on the server while the visitor picks an image.
  useEffect(() => {
    fetch("/api/warmup").catch(() => {});
  }, []);

  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  function showPick(file) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
    setFileName(file?.name ?? "");
    setError("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: new FormData(form) });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      setResult(data);
      form.reset();
      showPick(null);
    } catch {
      setError("Upload failed. Check the server log.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h1>Image Search</h1>
        <p>Upload an image to find visually similar ones. CLIP embeddings, searched with pgvector.</p>
      </header>

      <form className="card upload" onSubmit={onSubmit}>
        <div className="preview">
          {preview ? <img src={preview} alt="Preview of the selected image" /> : <span>No image</span>}
        </div>
        <div className="controls">
          <div className="actions">
            <label className="btn picker">
              {preview ? "Change image" : "Choose image"}
              <input
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => showPick(e.target.files[0])}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={!preview || busy}>
              {busy ? "Searching…" : "Upload & search"}
            </button>
          </div>
          <p className="hint">{fileName || "JPEG, PNG, WebP or GIF, up to 4 MB"}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </form>

      {result && (
        <section className="results">
          <div className="card">
            <h2>Your image</h2>
            <img className="query" src={result.url} alt="The image you uploaded" />
            <p className="note">
              {result.duplicate ? "Already in the library, so it wasn't stored again." : "Added to the library."}
            </p>
          </div>
          <div className="card">
            <h2>Similar images</h2>
            {result.similar.length === 0 ? (
              <p className="empty">No similar images found.</p>
            ) : (
              <ul className="grid">
                {result.similar.map((s) => {
                  const pct = (s.similarity * 100).toFixed(1);
                  return (
                    <li key={s.name} className="thumb">
                      <img src={s.url} alt={`Similar image, ${pct}% match`} />
                      <span className="score" aria-hidden="true">
                        {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
