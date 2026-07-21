import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/@techstark/opencv-js/dist/opencv.js");
const target = resolve(root, "public/vendor/opencv/opencv.js");
const licenseSource = resolve(root, "node_modules/@techstark/opencv-js/LICENSE");
const licenseTarget = resolve(root, "public/vendor/opencv/LICENSE");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
await copyFile(licenseSource, licenseTarget);

const ortSource = resolve(root, "node_modules/onnxruntime-web/dist");
const ortTarget = resolve(root, "public/vendor/onnxruntime");
await mkdir(ortTarget, { recursive: true });
for (const file of [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
]) {
  await copyFile(resolve(ortSource, file), resolve(ortTarget, file));
}
await copyFile(
  resolve(root, "licenses/onnxruntime.txt"),
  resolve(ortTarget, "LICENSE"),
);
