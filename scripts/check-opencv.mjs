import cvReady from "@techstark/opencv-js";

const cv = await cvReady;
if (typeof cv.inpaint !== "function" || cv.INPAINT_TELEA !== 1 || cv.INPAINT_NS !== 0) {
  throw new Error("The installed OpenCV.js build does not provide photo/inpaint.");
}

console.log("OpenCV.js photo/inpaint is available.");
