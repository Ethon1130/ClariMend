"use client";

import Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Check,
  Eraser,
  Hand,
  Maximize,
  MousePointer2,
  Paintbrush,
  Redo2,
  RotateCcw,
  ScanSearch,
  Sparkles,
  SquareDashed,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import ResultView from "@/components/result-view";
import { useAppPreferences } from "@/components/app-preferences";
import { useImageWorker } from "@/hooks/use-image-worker";
import type { DecodedImage } from "@/lib/decode-image";
import {
  fitImageToViewport,
  screenToImage,
  zoomAroundPoint,
  type Point,
  type ViewTransform,
} from "@/lib/coordinates";
import { commitHistory, createHistory, redoHistory, undoHistory } from "@/lib/history";
import { getMaskStats, normalizeRectangle, rasterizeMask, type MaskRectangle, type MaskShape } from "@/lib/mask";
import type { Candidate } from "@/lib/worker-messages";

type Tool = "select" | "rectangle" | "brush" | "eraser" | "hand";

type Props = {
  image: DecodedImage;
  onClear: () => void;
};

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function clampView(transform: ViewTransform, viewport: { width: number; height: number }, image: DecodedImage) {
  const visible = 72;
  const scaledWidth = image.work.width * transform.scale;
  const scaledHeight = image.work.height * transform.scale;
  const clampAxis = (value: number, viewportSize: number, imageSize: number) => {
    const min = visible - imageSize;
    const max = viewportSize - visible;
    return min > max ? (viewportSize - imageSize) / 2 : Math.min(max, Math.max(min, value));
  };
  return {
    ...transform,
    x: clampAxis(transform.x, viewport.width, scaledWidth),
    y: clampAxis(transform.y, viewport.height, scaledHeight),
  };
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function newId() {
  return crypto.randomUUID();
}

export default function ImageEditor({ image, onClear }: Props) {
  const { t } = useAppPreferences();
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage>(null);
  const selectedRectangleRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const previousViewport = useRef(viewport);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("rectangle");
  const [brushSize, setBrushSize] = useState(36);
  const [history, setHistory] = useState(() => createHistory<MaskShape[]>([]));
  const [draft, setDraft] = useState<MaskShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [resultDownloaded, setResultDownloaded] = useState(false);
  const pinch = useRef<{ distance: number; center: Point } | null>(null);
  const imageWorker = useImageWorker();
  const shapes = history.present;

  const stats = useMemo(() => {
    const mask = rasterizeMask(image.work.width, image.work.height, shapes);
    const result = getMaskStats(mask);
    mask.width = 0;
    mask.height = 0;
    return result;
  }, [image.work.height, image.work.width, shapes]);

  const fitView = useCallback(() => {
    if (!viewport.width || !viewport.height) return;
    setView(fitImageToViewport(image.work, viewport));
  }, [image.work, viewport]);

  useLayoutEffect(() => {
    if (!viewport.width || !viewport.height) return;
    const previous = previousViewport.current;
    if (!previous.width || !previous.height) {
      setView(fitImageToViewport(image.work, viewport));
    } else if (previous.width !== viewport.width || previous.height !== viewport.height) {
      setView((current) => {
        const imageCenter = screenToImage({ x: previous.width / 2, y: previous.height / 2 }, current);
        return clampView(
          {
            ...current,
            x: viewport.width / 2 - imageCenter.x * current.scale,
            y: viewport.height / 2 - imageCenter.y * current.scale,
          },
          viewport,
          image,
        );
      });
    }
    previousViewport.current = viewport;
  }, [image, viewport]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const rectangle = selectedRectangleRef.current;
    if (!transformer) return;
    transformer.nodes(rectangle ? [rectangle] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  const commit = useCallback((next: MaskShape[]) => {
    setHistory((current) => commitHistory(current, next));
  }, []);

  const undo = useCallback(() => {
    setSelectedId(null);
    setHistory((current) => undoHistory(current));
  }, []);

  const redo = useCallback(() => {
    setSelectedId(null);
    setHistory((current) => redoHistory(current));
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(shapes.filter((shape) => shape.id !== selectedId));
    setSelectedId(null);
  }, [commit, selectedId, shapes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [deleteSelected, redo, selectedId, undo]);

  useEffect(() => () => {
    if (result) {
      result.width = 0;
      result.height = 0;
    }
  }, [result]);

  useEffect(() => {
    if (!result || resultDownloaded) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [result, resultDownloaded]);

  const imagePoint = useCallback(() => {
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return null;
    const point = screenToImage(pointer, view);
    return {
      x: Math.min(image.work.width, Math.max(0, point.x)),
      y: Math.min(image.work.height, Math.max(0, point.y)),
    };
  }, [image.work.height, image.work.width, view]);

  const startDrawing = (event: KonvaEventObject<PointerEvent>) => {
    if (pinch.current || tool === "select" || tool === "hand" || spacePressed) {
      if (event.target === event.target.getStage()) setSelectedId(null);
      return;
    }
    const point = imagePoint();
    if (!point) return;
    if (tool === "rectangle") {
      setDraft({ id: newId(), kind: "rectangle", x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    setDraft({
      id: newId(),
      kind: "stroke",
      mode: tool === "eraser" ? "erase" : "add",
      points: [point.x, point.y],
      size: brushSize,
    });
  };

  const continueDrawing = () => {
    if (!draft || pinch.current) return;
    const point = imagePoint();
    if (!point) return;
    if (draft.kind === "rectangle") {
      setDraft({ ...draft, width: point.x - draft.x, height: point.y - draft.y });
      return;
    }
    const last = { x: draft.points.at(-2) ?? point.x, y: draft.points.at(-1) ?? point.y };
    if (pointDistance(last, point) < Math.max(1, draft.size * 0.12)) return;
    setDraft({ ...draft, points: [...draft.points, point.x, point.y] });
  };

  const finishDrawing = () => {
    if (!draft || pinch.current) return;
    if (draft.kind === "rectangle") {
      const normalized = normalizeRectangle(draft);
      if (normalized.width >= 2 && normalized.height >= 2) {
        const rectangle: MaskRectangle = { ...draft, ...normalized };
        commit([...shapes, rectangle]);
        setSelectedId(rectangle.id);
      }
    } else if (draft.points.length >= 2) {
      commit([...shapes, draft]);
    }
    setDraft(null);
  };

  const updateRectangle = (id: string, patch: Partial<MaskRectangle>) => {
    commit(shapes.map((shape) => (shape.id === id && shape.kind === "rectangle" ? { ...shape, ...patch } : shape)));
  };

  const acceptCandidate = (candidate: Candidate) => {
    const rectangle: MaskRectangle = {
      id: newId(),
      kind: "rectangle",
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    };
    commit([...shapes, rectangle]);
    setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    setSelectedId(rectangle.id);
    setCandidateMessage(null);
  };

  const detect = async () => {
    setCandidateMessage(null);
    try {
      const found = await imageWorker.detect(image);
      setCandidates(found);
      if (!found.length) setCandidateMessage(t.noCandidates);
    } catch {
      // The worker exposes a recoverable error state below.
    }
  };

  const repair = async () => {
    if (!stats.pixels || risk === "blocked") return;
    if (risk === "warning" && !window.confirm(t.confirmWarning)) return;
    const mask = rasterizeMask(image.work.width, image.work.height, shapes);
    try {
      const nextResult = await imageWorker.repair(image, mask);
      setResult((current) => {
        if (current) {
          current.width = 0;
          current.height = 0;
        }
        return nextResult;
      });
      setResultDownloaded(false);
      setShowResult(true);
    } catch {
      // The worker exposes a recoverable error state below.
    } finally {
      mask.width = 0;
      mask.height = 0;
    }
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const factor = event.evt.deltaY > 0 ? 0.9 : 1.1;
    setView((current) => clampView(zoomAroundPoint(current, pointer, current.scale * factor), viewport, image));
  };

  const handleTouchStart = (event: KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 2) return;
    event.evt.preventDefault();
    setDraft(null);
    const rect = event.target.getStage()?.container().getBoundingClientRect();
    if (!rect) return;
    const [first, second] = Array.from(event.evt.touches);
    const a = { x: first.clientX - rect.left, y: first.clientY - rect.top };
    const b = { x: second.clientX - rect.left, y: second.clientY - rect.top };
    pinch.current = {
      distance: pointDistance(a, b),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const handleTouchMove = (event: KonvaEventObject<TouchEvent>) => {
    if (!pinch.current || event.evt.touches.length !== 2) return;
    event.evt.preventDefault();
    const rect = event.target.getStage()?.container().getBoundingClientRect();
    if (!rect) return;
    const [first, second] = Array.from(event.evt.touches);
    const a = { x: first.clientX - rect.left, y: first.clientY - rect.top };
    const b = { x: second.clientX - rect.left, y: second.clientY - rect.top };
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = pointDistance(a, b);
    setView((current) => {
      const zoomed = zoomAroundPoint(current, pinch.current!.center, current.scale * (distance / pinch.current!.distance));
      return clampView(
        { ...zoomed, x: zoomed.x + center.x - pinch.current!.center.x, y: zoomed.y + center.y - pinch.current!.center.y },
        viewport,
        image,
      );
    });
    pinch.current = { distance, center };
  };

  const allShapes = draft ? [...shapes, draft] : shapes;
  const coveragePercent = stats.coverage * 100;
  const risk = coveragePercent > 25 ? "blocked" : coveragePercent > 10 ? "warning" : "normal";

  if (showResult && result) {
    return (
      <ResultView
        image={image}
        onDownloaded={() => setResultDownloaded(true)}
        onEdit={() => setShowResult(false)}
        result={result}
        shapes={shapes}
      />
    );
  }

  return (
    <section className="editor" aria-label={t.editorLabel}>
      <div className="editor-toolbar" role="toolbar" aria-label={t.maskTools}>
        {(
          [
            ["select", MousePointer2, t.tools.select],
            ["rectangle", SquareDashed, t.tools.rectangle],
            ["brush", Paintbrush, t.tools.brush],
            ["eraser", Eraser, t.tools.eraser],
            ["hand", Hand, t.tools.hand],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            aria-label={label}
            aria-pressed={tool === value}
            className="icon-button"
            data-active={tool === value}
            key={value}
            onClick={() => setTool(value)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" size={19} />
          </button>
        ))}
        <span className="toolbar-divider" aria-hidden="true" />
        <button aria-label={t.fit} className="icon-button" onClick={fitView} title={t.fit} type="button">
          <Maximize aria-hidden="true" size={19} />
        </button>
        <button aria-label={t.undo} className="icon-button" disabled={!history.past.length} onClick={undo} title={t.undo} type="button">
          <Undo2 aria-hidden="true" size={19} />
        </button>
        <button aria-label={t.redo} className="icon-button" disabled={!history.future.length} onClick={redo} title={t.redo} type="button">
          <Redo2 aria-hidden="true" size={19} />
        </button>
        <button aria-label={t.deleteSelection} className="icon-button" disabled={!selectedId} onClick={deleteSelected} title={t.deleteSelection} type="button">
          <Trash2 aria-hidden="true" size={19} />
        </button>
        <label className="brush-control">
          <span>{t.brush} {brushSize}px</span>
          <input
            aria-label={t.brushSize}
            max="180"
            min="4"
            onChange={(event) => setBrushSize(Number(event.target.value))}
            type="range"
            value={brushSize}
          />
        </label>
      </div>

      <div className="editor-body">
        <div className="canvas-viewport" ref={viewportRef}>
          {viewport.width > 0 && viewport.height > 0 ? (
            <Stage
              draggable={tool === "hand" || spacePressed}
              dragBoundFunc={(position) => clampView({ ...view, ...position }, viewport, image)}
              height={viewport.height}
              onDragEnd={(event) => setView((current) => ({ ...current, x: event.target.x(), y: event.target.y() }))}
              onPointerDown={startDrawing}
              onPointerMove={continueDrawing}
              onPointerUp={finishDrawing}
              onTouchEnd={() => {
                pinch.current = null;
              }}
              onTouchMove={handleTouchMove}
              onTouchStart={handleTouchStart}
              onWheel={handleWheel}
              ref={stageRef}
              scaleX={view.scale}
              scaleY={view.scale}
              width={viewport.width}
              x={view.x}
              y={view.y}
            >
              <Layer listening={false}>
                <KonvaImage height={image.work.height} image={image.canvas} width={image.work.width} />
              </Layer>
              <Layer>
                {candidates.map((candidate) => (
                  <Rect
                    dash={[8 / view.scale, 5 / view.scale]}
                    fill="rgba(33, 130, 123, 0.12)"
                    height={candidate.height}
                    key={candidate.id}
                    onClick={() => acceptCandidate(candidate)}
                    stroke="#126f69"
                    strokeWidth={2 / view.scale}
                    width={candidate.width}
                    x={candidate.x}
                    y={candidate.y}
                  />
                ))}
                {allShapes.map((shape) =>
                  shape.kind === "rectangle" ? (
                    <Rect
                      draggable={tool === "select"}
                      fill="rgba(245, 159, 28, 0.38)"
                      height={shape.height}
                      key={shape.id}
                      onClick={() => setSelectedId(shape.id)}
                      onDragEnd={(event) => {
                        const node = event.target;
                        updateRectangle(shape.id, {
                          x: Math.max(0, Math.min(image.work.width - shape.width, node.x())),
                          y: Math.max(0, Math.min(image.work.height - shape.height, node.y())),
                        });
                      }}
                      onTransformEnd={(event) => {
                        const node = event.target;
                        const width = Math.max(2, node.width() * node.scaleX());
                        const height = Math.max(2, node.height() * node.scaleY());
                        node.scaleX(1);
                        node.scaleY(1);
                        updateRectangle(shape.id, {
                          x: Math.max(0, node.x()),
                          y: Math.max(0, node.y()),
                          width: Math.min(width, image.work.width - Math.max(0, node.x())),
                          height: Math.min(height, image.work.height - Math.max(0, node.y())),
                        });
                      }}
                      ref={selectedId === shape.id ? selectedRectangleRef : undefined}
                      stroke={selectedId === shape.id ? "#9a5b00" : undefined}
                      strokeWidth={selectedId === shape.id ? 2 / view.scale : 0}
                      width={shape.width}
                      x={shape.x}
                      y={shape.y}
                    />
                  ) : (
                    <Line
                      globalCompositeOperation={shape.mode === "erase" ? "destination-out" : "source-over"}
                      key={shape.id}
                      lineCap="round"
                      lineJoin="round"
                      points={shape.points}
                      stroke="rgba(245, 159, 28, 0.52)"
                      strokeWidth={shape.size}
                      tension={0.18}
                    />
                  ),
                )}
                <Transformer
                  anchorFill="#ffffff"
                  anchorSize={10 / view.scale}
                  borderStroke="#9a5b00"
                  borderStrokeWidth={2 / view.scale}
                  flipEnabled={false}
                  ref={transformerRef}
                  rotateEnabled={false}
                />
              </Layer>
            </Stage>
          ) : null}
        </div>

        <aside className="editor-inspector" aria-label={t.inspectorLabel}>
          <div className="inspector-section">
            <div className="section-heading">
              <h2>{t.currentImage}</h2>
              <button className="text-button" onClick={onClear} type="button">{t.changeImage}</button>
            </div>
            <dl>
              <div><dt>{t.outputSize}</dt><dd>{image.work.width} × {image.work.height}</dd></div>
              <div><dt>{t.originalSize}</dt><dd>{image.source.width} × {image.source.height}</dd></div>
              <div><dt>{t.transparency}</dt><dd>{image.hasAlpha ? t.alphaKept : t.noAlpha}</dd></div>
            </dl>
            {image.downsampled ? <p className="info-message">{t.downsampled}</p> : null}
          </div>

          <div className="inspector-section">
            <div className="section-heading">
              <h2>{t.autoCandidates}</h2>
              <button className="text-button" disabled={imageWorker.status !== "idle"} onClick={() => void detect()} type="button">
                <ScanSearch aria-hidden="true" size={15} />
                {t.find}
              </button>
            </div>
            {candidates.length ? (
              <>
                <div className="candidate-actions">
                  <span>{t.candidatesCount(candidates.length)}</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      const accepted = candidates.map<MaskRectangle>((candidate) => ({
                        id: newId(), kind: "rectangle", x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height,
                      }));
                      commit([...shapes, ...accepted]);
                      setCandidates([]);
                    }}
                    type="button"
                  >{t.acceptAll}</button>
                  <button className="text-button" onClick={() => setCandidates([])} type="button">{t.ignore}</button>
                </div>
                <ul className="candidate-list">
                  {candidates.slice(0, 5).map((candidate, index) => (
                    <li key={candidate.id}>
                      <span>{t.candidate(index + 1)}</span>
                      <button aria-label={t.acceptCandidate(index + 1)} onClick={() => acceptCandidate(candidate)} title={t.acceptCandidate(index + 1)} type="button">
                        <Check aria-hidden="true" size={15} />
                      </button>
                      <button
                        aria-label={t.deleteCandidate(index + 1)}
                        onClick={() => setCandidates((current) => current.filter((item) => item.id !== candidate.id))}
                        title={t.deleteCandidate(index + 1)}
                        type="button"
                      >
                        <X aria-hidden="true" size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="candidate-message">{candidateMessage ?? t.candidateHint}</p>}
          </div>

          <div className="inspector-section">
            <h2>{t.repairArea}</h2>
            <div className="coverage-row">
              <strong>{coveragePercent.toFixed(2)}%</strong>
              <span>{stats.pixels.toLocaleString()} {t.pixels}</span>
            </div>
            <div className="coverage-track" aria-label={t.coverageLabel(coveragePercent.toFixed(2))}>
              <span data-risk={risk} style={{ width: `${Math.min(100, coveragePercent * 4)}%` }} />
            </div>
            {risk === "warning" ? <p className="warning-message">{t.warningArea}</p> : null}
            {risk === "blocked" ? <p className="error-message">{t.blockedArea}</p> : null}
          </div>

          {imageWorker.status !== "idle" && imageWorker.status !== "error" ? (
            <div className="task-status" aria-live="polite">
              <div className="coverage-row">
                <strong>{t.status[imageWorker.status]}</strong>
                <span>{Math.round(imageWorker.progress * 100)}%</span>
              </div>
              <progress max="1" value={imageWorker.progress} />
              <button className="text-button" onClick={imageWorker.cancel} type="button">{t.cancelTask}</button>
            </div>
          ) : null}
          {imageWorker.error ? (
            <div className="worker-error" role="alert">
              <p className="error-message">{imageWorker.error}</p>
              <button className="secondary-action" onClick={imageWorker.recover} type="button">{t.recoverWorker}</button>
            </div>
          ) : null}

          <button
            className="primary-action repair-action"
            disabled={!stats.pixels || risk === "blocked" || imageWorker.status !== "idle"}
            onClick={() => void repair()}
            type="button"
          >
            <Sparkles aria-hidden="true" size={18} />
            {t.repair}
          </button>
          <button className="secondary-action" onClick={() => setHistory(createHistory([]))} disabled={!shapes.length} type="button">
            <RotateCcw aria-hidden="true" size={18} />
            {t.clearMask}
          </button>
        </aside>
      </div>
    </section>
  );
}
