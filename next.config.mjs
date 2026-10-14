// Vercel functions must stay under 250 MB. onnxruntime-node ships native binaries for every OS
// (~200 MB), so keep only Linux x64, which Vercel runs. The include is needed too: the binding
// loads its .so files at runtime, which the file tracer can't see.
// Model weights are never bundled: they download at runtime (see lib/clip.js).
const ORT_BIN = "node_modules/**/onnxruntime-node/bin/napi-v3";

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingIncludes: { "/api/*": [`${ORT_BIN}/linux/x64/**`] },
  outputFileTracingExcludes: {
    "/api/*": [
      `${ORT_BIN}/{darwin,win32}/**`,
      `${ORT_BIN}/linux/arm64/**`,
      "node_modules/@huggingface/transformers/.cache/**",
    ],
  },
};
