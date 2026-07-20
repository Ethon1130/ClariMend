"use client";

import dynamic from "next/dynamic";
import { Camera, ImagePlus, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { decodeImageFile, releaseDecodedImage, type DecodedImage } from "@/lib/decode-image";
import { chooseWorkPixelLimit } from "@/lib/image-sizes";
import { ImageValidationError, validateImageFile } from "@/lib/image-validation";

const ImageEditor = dynamic(() => import("./image-editor"), {
  loading: () => <div className="editor-loading" aria-live="polite">正在加载本地编辑器...</div>,
  ssr: false,
});

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

export default function EditorShell() {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [authorized, setAuthorized] = useState(false);
  const [image, setImage] = useState<DecodedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => releaseDecodedImage(image), [image]);

  const clearImage = () => {
    setImage((current) => {
      releaseDecodedImage(current);
      return null;
    });
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  };

  const openFile = async (file?: File) => {
    if (!authorized || !file) return;
    setBusy(true);
    setError(null);
    try {
      const header = await validateImageFile(file);
      const navigatorInfo = navigator as NavigatorWithMemory;
      const workLimit = chooseWorkPixelLimit({
        deviceMemory: navigatorInfo.deviceMemory,
        touchPoints: navigator.maxTouchPoints,
        narrowViewport: window.matchMedia("(max-width: 820px)").matches,
      });
      const decoded = await decodeImageFile(file, header, workLimit);
      setImage((current) => {
        releaseDecodedImage(current);
        return decoded;
      });
    } catch (reason) {
      if (reason instanceof ImageValidationError) setError(reason.message);
      else if (reason instanceof DOMException && reason.name === "EncodingError") setError("图片解码失败，文件可能已损坏。");
      else setError("无法打开图片。设备内存不足时，请选择尺寸更小的文件后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="product-context">本地处理 · 单图编辑</p>
          <h1>授权图片区域修复</h1>
        </div>
        <span className="privacy-status"><LockKeyhole aria-hidden="true" size={16} /> 图片不上传</span>
      </header>

      {!image ? (
        <>
          <section className="consent" aria-labelledby="consent-title">
            <ShieldCheck aria-hidden="true" className="consent-icon" size={28} />
            <div>
              <h2 id="consent-title">开始前请确认授权</h2>
              <p>
                仅处理您拥有版权或已取得明确修改授权的图片。禁止移除他人版权标识、平台保护标记、素材站预览标记，
                或利用本工具规避付费、许可和访问限制。系统无法通过技术手段判断真实版权归属。
              </p>
            </div>
            <label className="consent-check">
              <input
                checked={authorized}
                onChange={(event) => {
                  setAuthorized(event.target.checked);
                  setError(null);
                }}
                type="checkbox"
              />
              <span>我确认符合上述授权要求</span>
            </label>
          </section>

          <section
            aria-describedby={error ? "file-error" : "file-help"}
            aria-label="选择图片"
            className="upload-zone"
            data-disabled={!authorized}
            data-dragging={dragging}
            onDragEnter={(event) => {
              event.preventDefault();
              if (authorized) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void openFile(event.dataTransfer.files[0]);
            }}
          >
            <ImagePlus aria-hidden="true" size={34} />
            <div>
              <h2>{authorized ? "选择一张需要处理的图片" : "确认授权后选择图片"}</h2>
              <p id="file-help">JPEG、PNG 或 WebP，最大 10 MB、1200 万像素。图片仅保存在当前页面内存中。</p>
            </div>
            <div className="upload-actions">
              <button
                className="primary-action"
                disabled={!authorized || busy}
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <ImagePlus aria-hidden="true" size={18} />
                {busy ? "正在检查..." : "选择图片"}
              </button>
              <button
                className="secondary-action"
                disabled={!authorized || busy}
                onClick={() => cameraInput.current?.click()}
                type="button"
              >
                <Camera aria-hidden="true" size={18} />
                拍照
              </button>
            </div>
            <input
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              disabled={!authorized}
              onChange={(event) => void openFile(event.target.files?.[0])}
              ref={fileInput}
              type="file"
            />
            <input
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="visually-hidden"
              disabled={!authorized}
              onChange={(event) => void openFile(event.target.files?.[0])}
              ref={cameraInput}
              type="file"
            />
          </section>
          {error ? <p className="file-error" id="file-error" role="alert">{error}</p> : null}
        </>
      ) : (
        <ImageEditor image={image} onClear={clearImage} />
      )}

      <footer>
        <a href="/terms">服务条款</a>
        <a href="/privacy">隐私说明</a>
        <a href="/complaints">投诉与下架</a>
      </footer>
    </main>
  );
}
