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
