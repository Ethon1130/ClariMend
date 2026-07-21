# Third-Party Notices

## OpenCV.js

- Package: `@techstark/opencv-js@4.11.0-release.1`
- Upstream build: OpenCV 4.11.0
- Runtime asset source: the installed npm package, copied locally by `npm run sync-opencv`
- License: Apache License 2.0; the packaged license is copied beside the runtime asset

The application loads this same-origin asset only when the user starts a repair task.

## ONNX Runtime Web

- Package: `onnxruntime-web@1.22.0`
- Runtime asset source: the installed npm package, copied locally by `npm run sync-opencv`
- License: MIT; the official license text is copied beside the runtime assets

The runtime is loaded only when the user chooses experimental smart repair.

## LaMa ONNX test model

- Model card: `Carve/LaMa-ONNX`
- Revision: `c3c0c9e468934d62e79c329e35d82dd09ff8c444`
- File: `lama_fp32.onnx`
- SHA-256: `b31eab2d65e4b53296a6b73916fcc6b61d13c5036c99593e8579da43ccb64c81`
- Model card license: Apache License 2.0
- Source: `https://huggingface.co/Carve/LaMa-ONNX`
- Size: 208,044,816 bytes

The model is not stored in this repository. It is downloaded directly after explicit user confirmation and used only for local browser inference.
