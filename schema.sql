-- Run once against the image_search database:
--   /Library/PostgreSQL/14/bin/psql -U postgres -d image_search -f schema.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS images (
  id         bigserial PRIMARY KEY,
  filename   text NOT NULL UNIQUE,          -- file name inside uploads/
  embedding  vector(512) NOT NULL,          -- CLIP ViT-B/32 image embedding
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Approximate nearest-neighbour index for cosine distance (<=>).
CREATE INDEX IF NOT EXISTS images_embedding_idx ON images USING hnsw (embedding vector_cosine_ops);
