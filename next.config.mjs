// Vercel functions must stay under 250 MB. onnxruntime-node ships native binaries for every OS
// (~200 MB), so keep only Linux x64, which Vercel runs.
// transformers.js loads onnxruntime-node via createRequire(), which the file tracer can't follow,
// so its JS, its onnxruntime-common dependency and the Linux binaries are all included by hand.
// Model weights are never bundled: they download at runtime (see lib/clip.js).
const ORT = "node_modules/**/onnxruntime-node";
const ORT_BIN = `${ORT}/bin/napi-v3`;

/** @type {import('next').NextConfig} */
export default {
  outputFileTracingIncludes: {
    "/api/*": [
      `${ORT}/package.json`,
      `${ORT}/dist/**`,
      `${ORT_BIN}/linux/x64/**`,
      "node_modules/**/onnxruntime-common/**",
    ],
  },
  outputFileTracingExcludes: {
    "/api/*": [
      `${ORT_BIN}/{darwin,win32}/**`,
      `${ORT_BIN}/linux/arm64/**`,
      "node_modules/@huggingface/transformers/.cache/**",
    ],
  },
};
