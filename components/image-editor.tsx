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
  Stamp,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import ResultView from "@/components/result-view";
import { useAppPreferences } from "@/components/app-preferences";
import { useImageWorker } from "@/hooks/use-image-worker";
import { renderCloneStrokes, type CloneStroke } from "@/lib/clone-stamp";
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
import type { Candidate, RepairMethod } from "@/lib/worker-messages";

type Tool = "select" | "rectangle" | "brush" | "eraser" | "clone" | "hand";
type EditorCommand = MaskShape | CloneStroke;

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

function isMaskShape(command: EditorCommand): command is MaskShape {
  return command.kind !== "clone";
}

function copyCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas-unavailable");
  context.drawImage(source, 0, 0);
  return canvas;
}

export default function ImageEditor({ image, onClear }: Props) {
  const { t } = useAppPreferences();
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>();
  const stageRef = useRef<Konva.Stage>(null);
  const selectedRectangleRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const previousEditedCanvas = useRef<HTMLCanvasElement | null>(null);
  const previousViewport = useRef(viewport);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("rectangle");
  const [brushSize, setBrushSize] = useState(36);
  const [history, setHistory] = useState(() => createHistory<EditorCommand[]>([]));
  const [draft, setDraft] = useState<EditorCommand | null>(null);
  const [cloneSource, setCloneSource] = useState<Point | null>(null);
  const [repairMethod, setRepairMethod] = useState<RepairMethod>("traditional");
  const [lamaApproved, setLamaApproved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [result, setResult] = useState<HTMLCanvasElement | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [resultDownloaded, setResultDownloaded] = useState(false);
  const pinch = useRef<{ distance: number; center: Point } | null>(null);
  const imageWorker = useImageWorker();
  const commands = history.present;
  const maskShapes = useMemo(() => commands.filter(isMaskShape), [commands]);
  const cloneStrokes = useMemo(
    () => commands.filter((command): command is CloneStroke => command.kind === "clone"),
    [commands],
  );
  const previewCloneStrokes = useMemo(
    () => (draft?.kind === "clone" ? [...cloneStrokes, draft] : cloneStrokes),
    [cloneStrokes, draft],
  );
  const editedCanvas = useMemo(
    () => renderCloneStrokes(image.canvas, previewCloneStrokes),
    [image.canvas, previewCloneStrokes],
  );

  useEffect(() => {
    const previous = previousEditedCanvas.current;
    previousEditedCanvas.current = editedCanvas;
    if (previous && previous !== editedCanvas) {
      previous.width = 0;
      previous.height = 0;
    }
  }, [editedCanvas]);

  const stats = useMemo(() => {
    const mask = rasterizeMask(image.work.width, image.work.height, maskShapes);
    const result = getMaskStats(mask);
    mask.width = 0;
    mask.height = 0;
    return result;
  }, [image.work.height, image.work.width, maskShapes]);

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
  }, [commands, selectedId]);

  const commit = useCallback((next: EditorCommand[]) => {
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
    commit(commands.filter((command) => command.id !== selectedId));
    setSelectedId(null);
  }, [commands, commit, selectedId]);

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
    if (tool === "clone") {
      if (event.evt.altKey || !cloneSource) {
        setCloneSource(point);
        setDraft(null);
        return;
      }
      setDraft({
        id: newId(),
        kind: "clone",
        points: [point.x, point.y],
        size: brushSize,
        offsetX: cloneSource.x - point.x,
        offsetY: cloneSource.y - point.y,
      });
      return;
    }
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
        commit([...commands, rectangle]);
        setSelectedId(rectangle.id);
      }
    } else if (draft.points.length >= 2) {
      commit([...commands, draft]);
    }
    setDraft(null);
  };

  const updateRectangle = (id: string, patch: Partial<MaskRectangle>) => {
    commit(commands.map((command) => (command.id === id && command.kind === "rectangle" ? { ...command, ...patch } : command)));
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
    commit([...commands, rectangle]);
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
    if ((!stats.pixels && !cloneStrokes.length) || risk === "blocked") return;
    if (risk === "warning" && !window.confirm(t.confirmWarning)) return;
    if (!stats.pixels && cloneStrokes.length) {
      setResult((current) => {
        if (current) {
          current.width = 0;
          current.height = 0;
        }
        return copyCanvas(editedCanvas);
      });
      setResultDownloaded(false);
      setShowResult(true);
      return;
    }
    if (repairMethod === "lama" && !lamaApproved) {
      if (!window.confirm(t.confirmLamaDownload)) return;
      setLamaApproved(true);
    }
    const mask = rasterizeMask(image.work.width, image.work.height, maskShapes);
    try {
      const nextResult = await imageWorker.repair(image, editedCanvas, mask, repairMethod);
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

  const visibleMaskShapes = draft && isMaskShape(draft) ? [...maskShapes, draft] : maskShapes;
  const coveragePercent = stats.coverage * 100;
  const risk = coveragePercent > 25 ? "blocked" : coveragePercent > 10 ? "warning" : "normal";

  if (showResult && result) {
    return (
      <ResultView
        image={image}
        onDownloaded={() => setResultDownloaded(true)}
        onEdit={() => setShowResult(false)}
        result={result}
        shapes={maskShapes}
        cloneCount={cloneStrokes.length}
      />
    );
  }

  return (
    <section className="editor" aria-label={t.editorLabel}>
      <div className="editor-toolbar" role="toolbar" aria-label={t.maskTools}>
        <div className="toolbar-cluster" aria-label={t.toolGroupLabel}>
          {(
            [
              ["select", MousePointer2, t.tools.select],
              ["rectangle", SquareDashed, t.tools.rectangle],
              ["brush", Paintbrush, t.tools.brush],
              ["eraser", Eraser, t.tools.eraser],
              ["clone", Stamp, t.tools.clone],
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
        </div>
        <div className="toolbar-cluster" aria-label={t.viewGroupLabel}>
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
        </div>
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
          <div className="canvas-status" aria-live="polite">
            <span>{t.activeTool}: {t.tools[tool]}</span>
            <span>{Math.round(view.scale * 100)}%</span>
            <span>{t.maskCount(maskShapes.length)}</span>
            {cloneStrokes.length ? <span>{t.cloneCount(cloneStrokes.length)}</span> : null}
          </div>
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
                <KonvaImage height={image.work.height} image={editedCanvas} width={image.work.width} />
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
                {visibleMaskShapes.map((shape) =>
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
                {tool === "clone" && cloneSource ? (
                  <Circle
                    fill="rgba(18, 111, 105, 0.18)"
                    listening={false}
                    radius={Math.max(5, brushSize / 2)}
                    stroke="#126f69"
                    strokeWidth={2 / view.scale}
                    x={cloneSource.x}
                    y={cloneSource.y}
                  />
                ) : null}
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
                      commit([...commands, ...accepted]);
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
            <h2>{t.repairMethod}</h2>
            <div className="segmented-control repair-method-control" aria-label={t.repairMethod}>
              {(["traditional", "lama"] as const).map((method) => (
                <button
                  aria-pressed={repairMethod === method}
                  key={method}
                  onClick={() => setRepairMethod(method)}
                  type="button"
                >
                  {t.repairMethods[method]}
                </button>
              ))}
            </div>
            <p className="candidate-message">{t.repairMethodHint[repairMethod]}</p>
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
            {!stats.pixels ? <p className="candidate-message">{cloneStrokes.length ? t.cloneOnlyHint : t.maskEmptyHint}</p> : null}
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
            disabled={(!stats.pixels && !cloneStrokes.length) || risk === "blocked" || imageWorker.status !== "idle"}
            onClick={() => void repair()}
            type="button"
          >
            <Sparkles aria-hidden="true" size={18} />
            {!stats.pixels && cloneStrokes.length ? t.previewResult : t.repair}
          </button>
          <button
            className="secondary-action"
            onClick={() => {
              setHistory(createHistory([]));
              setCloneSource(null);
            }}
            disabled={!commands.length}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={18} />
            {t.clearEdits}
          </button>
        </aside>
      </div>
    </section>
  );
}
