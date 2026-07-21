"use client";

import { ArrowLeft, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import type { DecodedImage } from "@/lib/decode-image";
import { rasterizeMask, type MaskShape } from "@/lib/mask";

type Mode = "compare" | "result" | "original" | "mask";
type Format = "image/jpeg" | "image/png" | "image/webp";

type Props = {
  image: DecodedImage;
  result: HTMLCanvasElement;
  shapes: MaskShape[];
  onEdit: () => void;
  onDownloaded: () => void;
};

function outputName(fileName: string, format: Format, suffix: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const extension = format === "image/jpeg" ? "jpg" : format === "image/png" ? "png" : "webp";
  return `${stem}-${suffix}.${extension}`;
}

export default function ResultView({ image, result, shapes, onEdit, onDownloaded }: Props) {
  const { t } = useAppPreferences();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>("compare");
  const [split, setSplit] = useState(50);
  const [format, setFormat] = useState<Format>(image.hasAlpha ? "image/png" : "image/jpeg");
  const [quality, setQuality] = useState(0.92);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.preview.width;
    canvas.height = image.preview.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (mode === "original") {
      context.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
    } else if (mode === "result") {
      context.drawImage(result, 0, 0, canvas.width, canvas.height);
    } else if (mode === "mask") {
      context.globalAlpha = 0.4;
      context.drawImage(image.canvas, 0, 0, canvas.width, canvas.height);
      context.globalAlpha = 1;
      const mask = rasterizeMask(image.work.width, image.work.height, shapes);
      const overlay = document.createElement("canvas");
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      const overlayContext = overlay.getContext("2d");
      if (overlayContext) {
        overlayContext.drawImage(mask, 0, 0, overlay.width, overlay.height);
        overlayContext.globalCompositeOperation = "source-in";
        overlayContext.fillStyle = "oklch(0.56 0.15 68 / 0.72)";
        overlayContext.fillRect(0, 0, overlay.width, overlay.height);
        context.drawImage(overlay, 0, 0);
      }
      mask.width = 0;
      mask.height = 0;
      overlay.width = 0;
      overlay.height = 0;
    } else {
      const splitX = Math.round((canvas.width * split) / 100);
      context.drawImage(image.canvas, 0, 0, image.work.width * (splitX / canvas.width), image.work.height, 0, 0, splitX, canvas.height);
      context.drawImage(
        result,
        image.work.width * (splitX / canvas.width),
        0,
        image.work.width * (1 - splitX / canvas.width),
        image.work.height,
        splitX,
        0,
        canvas.width - splitX,
        canvas.height,
      );
      context.fillStyle = "white";
      context.fillRect(splitX - 1, 0, 2, canvas.height);
      context.fillStyle = "oklch(0.205 0.018 60)";
      context.fillRect(splitX, 0, 1, canvas.height);
    }
  }, [image, mode, result, shapes, split]);

  const download = () => {
    setMessage(null);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = image.work.width;
    exportCanvas.height = image.work.height;
    const context = exportCanvas.getContext("2d");
    if (!context) return setMessage(t.canvasUnavailable);
    if (format === "image/jpeg" && image.hasAlpha) {
      context.fillStyle = "white";
      context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    }
    context.drawImage(result, 0, 0);
    exportCanvas.toBlob(
      (blob) => {
        exportCanvas.width = 0;
        exportCanvas.height = 0;
        if (!blob) return setMessage(t.unsupportedEncoding);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = outputName(image.fileName, format, t.repairedSuffix);
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        onDownloaded();
        setMessage(t.downloadStarted);
      },
      format,
      format === "image/png" ? undefined : quality,
    );
  };

  return (
    <section className="result-view" aria-label={t.resultLabel}>
      <div className="result-toolbar">
        <button className="secondary-action" onClick={onEdit} type="button">
          <ArrowLeft aria-hidden="true" size={18} />
          {t.editAgain}
        </button>
        <div className="segmented-control" aria-label={t.resultModeLabel}>
          {(["compare", "result", "original", "mask"] as const).map((value) => (
            <button aria-pressed={mode === value} key={value} onClick={() => setMode(value)} type="button">
              {t.modes[value]}
            </button>
          ))}
        </div>
      </div>

      <div className="result-body">
        <div className="result-preview">
          <canvas ref={canvasRef} />
          {mode === "compare" ? (
            <label className="compare-slider">
              <span className="visually-hidden">{t.compareBoundary}</span>
              <input max="100" min="0" onChange={(event) => setSplit(Number(event.target.value))} type="range" value={split} />
            </label>
          ) : null}
        </div>

        <aside className="export-panel">
          <h2>{t.downloadResult}</h2>
          <label>
            <span>{t.format}</span>
            <select onChange={(event) => setFormat(event.target.value as Format)} value={format}>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
          </label>
          {format !== "image/png" ? (
            <label>
              <span>{t.quality} {quality.toFixed(2)}</span>
              <input max="1" min="0.5" onChange={(event) => setQuality(Number(event.target.value))} step="0.01" type="range" value={quality} />
            </label>
          ) : null}
          {format === "image/jpeg" && image.hasAlpha ? (
            <p className="warning-message">{t.jpegAlphaWarning}</p>
          ) : null}
          <button className="primary-action" onClick={download} type="button">
            <Download aria-hidden="true" size={18} />
            {t.download}
          </button>
          {message ? <p aria-live="polite" className="download-message">{message}</p> : null}
        </aside>
      </div>
    </section>
  );
}
