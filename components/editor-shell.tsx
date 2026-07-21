"use client";

import dynamic from "next/dynamic";
import { Camera, ImagePlus, Languages, LockKeyhole, Moon, ShieldCheck, Sun } from "lucide-react";
import { useRef, useState } from "react";
import { AppPreferencesProvider, useAppPreferences } from "@/components/app-preferences";
import { decodeImageFile, type DecodedImage } from "@/lib/decode-image";
import { chooseWorkPixelLimit } from "@/lib/image-sizes";
import { ImageValidationError, validateImageFile } from "@/lib/image-validation";

const ImageEditor = dynamic(() => import("./image-editor"), {
  loading: () => <div className="editor-loading" aria-live="polite">正在加载本地编辑器...</div>,
  ssr: false,
});

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

function EditorShellInner() {
  const { language, theme, t, toggleLanguage, toggleTheme } = useAppPreferences();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [authorized, setAuthorized] = useState(false);
  const [image, setImage] = useState<DecodedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearImage = () => {
    setImage(null);
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
      setImage(decoded);
    } catch (reason) {
      if (reason instanceof ImageValidationError) setError(t.validation[reason.code]);
      else if (reason instanceof DOMException && reason.name === "EncodingError") setError(t.decodeFailed);
      else setError(t.openFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#16786f" />
            <path
              d="M22.4 10.2a8 8 0 1 0 0 11.6"
              fill="none"
              stroke="#fff"
              strokeLinecap="round"
              strokeWidth="3.2"
            />
            <path
              d="M23 14.2v3.6"
              fill="none"
              stroke="#9fe3d8"
              strokeLinecap="round"
              strokeWidth="3.2"
            />
          </svg>
          <div className="brand-copy">
            <h1 aria-label={`澄迹 ClariMend — ${t.title}`} className="brand-name">
              <span className="brand-zh">澄迹</span>
              <span className="brand-en" lang="en">ClariMend</span>
            </h1>
            <p className="product-context">{t.localContext}</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="privacy-status"><LockKeyhole aria-hidden="true" size={16} /> {t.private}</span>
          <button className="preference-button" onClick={toggleTheme} type="button">
            {theme === "light" ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
            {theme === "light" ? t.themeLight : t.themeDark}
          </button>
          <button className="preference-button" onClick={toggleLanguage} type="button">
            <Languages aria-hidden="true" size={16} />
            {language === "zh" ? "中文" : "English"}
            <span className="visually-hidden">{t.languageToggle}</span>
          </button>
        </div>
      </header>

      <nav className="workflow-rail" aria-label={t.workflowLabel}>
        {t.workflow.map((step, index) => (
          <span
            aria-current={(!image && index === 0) || (image && index === 2) ? "step" : undefined}
            className="workflow-step"
            data-active={(!image && index === 0) || (image && index === 2)}
            key={step}
          >
            <span aria-hidden="true">{index + 1}</span>
            {step}
          </span>
        ))}
      </nav>

      {!image ? (
        <div className="intake-flow">
          <section className="consent" aria-labelledby="consent-title">
            <div className="consent-intro">
              <ShieldCheck aria-hidden="true" className="consent-icon" size={28} />
              <div>
                <h2 id="consent-title">{t.consentTitle}</h2>
                <p id="consent-description">{t.consentBody}</p>
              </div>
            </div>
            <label className="consent-check">
              <input
                aria-describedby="consent-description"
                checked={authorized}
                onChange={(event) => {
                  setAuthorized(event.target.checked);
                  setError(null);
                }}
                type="checkbox"
              />
              <span>{t.consentCheck}</span>
            </label>
          </section>

          <section
            aria-describedby={error ? "file-error" : "file-help"}
            aria-label={t.chooseImageLabel}
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
              <h2>{authorized ? t.uploadReady : t.uploadLocked}</h2>
              <p id="file-help">{t.fileHelp}</p>
            </div>
            <ul className="upload-facts" aria-label={t.uploadFactsLabel}>
              {t.uploadFacts.map((fact) => <li key={fact}>{fact}</li>)}
            </ul>
            <div className="upload-actions">
              <button
                className="primary-action"
                disabled={!authorized || busy}
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <ImagePlus aria-hidden="true" size={18} />
                {busy ? t.checking : t.chooseImageLabel}
              </button>
              <button
                className="secondary-action"
                disabled={!authorized || busy}
                onClick={() => cameraInput.current?.click()}
                type="button"
              >
                <Camera aria-hidden="true" size={18} />
                {t.takePhoto}
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
        </div>
      ) : (
        <ImageEditor image={image} onClear={clearImage} />
      )}

      <footer>
        <a href="/terms">{t.terms}</a>
        <a href="/privacy">{t.privacy}</a>
        <a href="/complaints">{t.complaints}</a>
      </footer>
    </main>
  );
}

export default function EditorShell() {
  return (
    <AppPreferencesProvider>
      <EditorShellInner />
    </AppPreferencesProvider>
  );
}
