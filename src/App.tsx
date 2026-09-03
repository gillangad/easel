import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BringToFront,
  Check,
  Circle,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  Hand,
  Image as ImageIcon,
  Layers3,
  Lock,
  PanelLeft,
  PanelLeftClose,
  Palette,
  Plus,
  Redo2,
  Save,
  Scan,
  SendToBack,
  Settings2,
  Square,
  Triangle,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import {
  dispatchCommand,
  type Command,
  type CreateArtboardInput,
  tryDispatchCommand,
} from './commands';
import {
  clamp,
  clampLeftPanelWidth,
  createId,
  deepClone,
  syncActiveFile,
  createInitialDocument,
  createInitialState,
  getLeftPanelBounds,
  getAbsolutePosition,
  getAbsoluteRect,
  getAncestorIds,
  getArtboardForNode,
  getArtboards,
  getBoundingRect,
  getDescendantIds,
  getPage,
  getPageNodeIds,
  nowIso,
} from './model';
import { downloadBlob, prepareArtboardExport, snapshotId } from './exports';
import { loadEditorState, saveEditorState } from './persistence';
import { registerWebMCPTools } from './webmcp';
import type {
  AlignItems,
  ArtboardPreset,
  DesignNode,
  DocumentModel,
  EditorState,
  ExportFormat,
  ElementPatch,
  ElementSpec,
  ImageAsset,
  LayoutMode,
  Point,
  PreviewState,
  ThemeMode,
  Viewport,
  ShapeKind,
} from './types';

type ToolName = 'select' | 'pan' | 'add-frame' | 'text' | ShapeKind;
type ToastKind = 'info' | 'success' | 'warning' | 'error';
type ToastState = { kind: ToastKind; message: string };
type PreviewTransform = { x: number; y: number; width: number; height: number; rotation: number };
type DragSession =
  | { kind: 'pan'; startX: number; startY: number; startPan: Point }
  | { kind: 'move'; startX: number; startY: number; ids: string[]; base: Record<string, PreviewTransform> }
  | { kind: 'resize'; startX: number; startY: number; nodeId: string; corner: string; base: PreviewTransform }
  | { kind: 'rotate'; startX: number; startY: number; nodeId: string; base: PreviewTransform; center: Point };

const FONT_OPTIONS = [
  'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, serif',
  'Verdana, sans-serif',
  'ui-monospace, SFMono-Regular, Menlo, monospace',
];

const TOOL_LABELS: Record<ToolName, string> = {
  select: 'Select',
  pan: 'Pan',
  'add-frame': 'Add Frame',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  polygon: 'Polygon',
  text: 'Text',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function hexColor(value: string, fallback = '#deded9'): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function pointInRect(point: Point, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
}

function frameDepth(document: DocumentModel, id: string): number {
  let depth = 0;
  let node = document.nodes[id];
  while (node?.parentId) {
    depth += 1;
    node = document.nodes[node.parentId];
  }
  return depth;
}

function getFrameAtPoint(document: DocumentModel, point: Point): DesignNode | undefined {
  return Object.values(document.nodes)
    .filter((node) => (node.type === 'artboard' || node.type === 'frame') && !node.hidden && pointInRect(point, getAbsoluteRect(document, node.id)))
    .sort((a, b) => {
      const depthDelta = frameDepth(document, b.id) - frameDepth(document, a.id);
      if (depthDelta) return depthDelta;
      return a.width * a.height - b.width * b.height;
    })[0];
}

function imagePalette(image: HTMLImageElement): string[] {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 12;
    canvas.height = 12;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(image, 0, 0, 12, 12);
    const pixels = context.getImageData(0, 0, 12, 12).data;
    const buckets = new Map<string, number>();
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] < 30) continue;
      const r = Math.round(pixels[index] / 32) * 32;
      const g = Math.round(pixels[index + 1] / 32) * 32;
      const b = Math.round(pixels[index + 2] / 32) * 32;
      const key = `#${[r, g, b].map((channel) => Math.min(255, channel).toString(16).padStart(2, '0')).join('')}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([color]) => color);
  } catch {
    return [];
  }
}

function readImageAsset(file: File, sourceLabel = 'Uploaded'): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error('Only supported local image files can be added.'));
        return;
      }
      const image = new Image();
      image.onerror = () => reject(new Error('The image dimensions could not be read.'));
      image.onload = () => {
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        if (!naturalWidth || !naturalHeight) {
          reject(new Error('The image has no usable dimensions.'));
          return;
        }
        resolve({
          id: createId('asset'),
          dataUrl,
          originalName: file.name.slice(0, 160) || 'Pasted image',
          naturalWidth,
          naturalHeight,
          aspectRatio: Number((naturalWidth / naturalHeight).toFixed(4)),
          palette: imagePalette(image),
          sourceLabel,
          createdAt: nowIso(),
        });
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function getLocalPreviewRect(document: DocumentModel, id: string, preview: Record<string, PreviewTransform>): { x: number; y: number; width: number; height: number; rotation: number } {
  const node = document.nodes[id];
  const base = getAbsoluteRect(document, id);
  const transform = preview[id];
  if (!node || !transform) return base;
  const parentPosition = node.parentId ? getAbsolutePosition(document, node.parentId) : { x: 0, y: 0 };
  return { x: parentPosition.x + transform.x, y: parentPosition.y + transform.y, width: transform.width, height: transform.height, rotation: transform.rotation };
}

function measureTextBoxHeight(node: DesignNode, width: number, content = node.content ?? ''): number {
  if (node.type !== 'text' || typeof window === 'undefined' || !window.document.body) return node.height;
  const measure = window.document.createElement('div');
  const border = node.style.borderWidth * 2;
  measure.textContent = content || ' ';
  measure.style.position = 'fixed';
  measure.style.left = '-100000px';
  measure.style.top = '0';
  measure.style.width = `${Math.max(1, width - border)}px`;
  measure.style.fontFamily = node.style.fontFamily;
  measure.style.fontSize = `${node.style.fontSize}px`;
  measure.style.fontWeight = String(node.style.fontWeight);
  measure.style.lineHeight = String(node.style.lineHeight);
  measure.style.letterSpacing = `${node.style.letterSpacing}px`;
  measure.style.whiteSpace = 'pre-wrap';
  measure.style.overflowWrap = 'anywhere';
  measure.style.wordBreak = 'break-word';
  measure.style.boxSizing = 'border-box';
  window.document.body.appendChild(measure);
  const height = Math.ceil(measure.getBoundingClientRect().height) + border;
  measure.remove();
  return Math.max(Math.ceil(node.style.fontSize * node.style.lineHeight) + border, height);
}

function computeFitViewport(document: DocumentModel, ids: string[], stageWidth: number, stageHeight: number, preferredZoom = 1): Viewport | null {
  const bounds = getBoundingRect(document, ids);
  if (!bounds || stageWidth < 1 || stageHeight < 1) return null;
  const padding = 72;
  const zoom = clamp(Math.min((stageWidth - padding * 2) / bounds.width, (stageHeight - padding * 2) / bounds.height, preferredZoom), 0.18, 1.35);
  return { zoom, pan: { x: (stageWidth - bounds.width * zoom) / 2 - bounds.x * zoom, y: (stageHeight - bounds.height * zoom) / 2 - bounds.y * zoom } };
}

function nodeIcon(type: DesignNode['type']): ReactNode {
  if (type === 'artboard') return <Frame size={15} />;
  if (type === 'frame') return <Layers3 size={15} />;
  if (type === 'text') return <Type size={15} />;
  if (type === 'image') return <ImageIcon size={15} />;
  return <Square size={15} />;
}

function nodeTypeLabel(type: DesignNode['type']): string {
  return type === 'artboard' ? 'frame' : type;
}

function feedbackDisplayIds(document: DocumentModel, ids: string[]): string[] {
  const result = new Set<string>();
  ids.forEach((id) => {
    const node = document.nodes[id];
    if (!node) return;
    result.add(node.id);
    const design = getArtboardForNode(document, node.id);
    if (design) result.add(design.id);
  });
  return [...result];
}

function isEffectivelyLocked(document: DocumentModel, id: string): boolean {
  let node: DesignNode | undefined = document.nodes[id];
  while (node) {
    if (node.locked) return true;
    node = node.parentId ? document.nodes[node.parentId] : undefined;
  }
  return false;
}

function getSiblingIds(document: DocumentModel, node: DesignNode): string[] {
  if (node.parentId) return document.nodes[node.parentId]?.childIds ?? [];
  return getPage(document, node.pageId)?.rootIds ?? [];
}

function getBeforeIdForVisualDrop(document: DocumentModel, draggedId: string, targetId: string, placeBefore: boolean): string | null {
  const dragged = document.nodes[draggedId];
  const target = document.nodes[targetId];
  if (!dragged || !target || draggedId === targetId || dragged.parentId !== target.parentId) return null;
  const visual = getSiblingIds(document, dragged).filter((id) => id !== draggedId).reverse();
  const targetIndex = visual.indexOf(targetId);
  if (targetIndex < 0) return null;
  visual.splice(targetIndex + (placeBefore ? 0 : 1), 0, draggedId);
  const internal = visual.reverse();
  const nextIndex = internal.indexOf(draggedId);
  return nextIndex >= 0 ? internal[nextIndex + 1] ?? null : null;
}

function viewportKeepingNodeVisible(document: DocumentModel, id: string, stageWidth: number, stageHeight: number): Viewport | null {
  const node = document.nodes[id];
  if (!node || stageWidth < 1 || stageHeight < 1) return null;
  const rect = getAbsoluteRect(document, id);
  const zoom = document.viewport.zoom;
  const margin = 44;
  const screenLeft = rect.x * zoom + document.viewport.pan.x;
  const screenTop = rect.y * zoom + document.viewport.pan.y;
  const screenRight = (rect.x + rect.width) * zoom + document.viewport.pan.x;
  const screenBottom = (rect.y + rect.height) * zoom + document.viewport.pan.y;
  let pan = { ...document.viewport.pan };
  if (screenRight < margin || screenLeft > stageWidth - margin) {
    pan.x = stageWidth / 2 - (rect.x + rect.width / 2) * zoom;
  }
  if (screenBottom < margin || screenTop > stageHeight - margin) {
    pan.y = stageHeight / 2 - (rect.y + rect.height / 2) * zoom;
  }
  if (pan.x === document.viewport.pan.x && pan.y === document.viewport.pan.y) return null;
  return { ...document.viewport, pan };
}

export default function App() {
  const [state, setState] = useState<EditorState>(() => ({ ...createInitialState(), focus: null, preview: null }));
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<ToolName>('select');
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportScale, setExportScale] = useState<1 | 2>(1);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pulseIds, setPulseIds] = useState<string[]>([]);
  const [agentWorkingIds, setAgentWorkingIds] = useState<string[]>([]);
  const [layerRevealRequest, setLayerRevealRequest] = useState<{ token: number; ids: string[] }>({ token: 0, ids: [] });
  const [lastActiveDesignId, setLastActiveDesignId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<Record<string, PreviewTransform>>({});
  const dragPreviewRef = useRef<Record<string, PreviewTransform>>({});
  const dragFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const agentWorkRef = useRef(new Map<string, { ids: string[]; startedAt: number; safetyTimer: number; finishTimer?: number }>());
  const revealTokenRef = useRef(0);
  const clipboardIdsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const panelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [panelResizing, setPanelResizing] = useState(false);
  const [editorViewportWidth, setEditorViewportWidth] = useState(() => typeof window === 'undefined' ? 1200 : window.innerWidth);
  const initialFitRef = useRef(false);

  const commit = useCallback((next: EditorState) => {
    const synced = syncActiveFile(next);
    stateRef.current = synced;
    setState(synced);
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const markPulse = useCallback((ids: string[]) => {
    const displayIds = feedbackDisplayIds(stateRef.current.document, ids);
    if (!displayIds.length) return;
    setPulseIds((current) => [...new Set([...current, ...displayIds])]);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseIds([]), 720);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadEditorState().then((next) => {
      if (cancelled) return;
      stateRef.current = next;
      setState(next);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => { void saveEditorState(stateRef.current); }, 220);
    return () => window.clearTimeout(timer);
  }, [loaded, state.activeFileId, state.document.revision, state.document.updatedAt, state.files, state.theme, state.panels]);

  useEffect(() => {
    if (!loaded) return;
    const measure = () => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setEditorViewportWidth(Math.min(window.innerWidth, workspaceWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loaded]);

  const runCommand = useCallback((command: Command, successKind: ToastKind = 'info'): boolean => {
    const current = stateRef.current;
    const outcome = tryDispatchCommand(current, command);
    if (outcome.error) {
      notify(outcome.error.message, 'error');
      return false;
    }
    if (outcome.state !== current) {
      commit(outcome.state);
      if (outcome.state.lastAction) {
        markPulse(outcome.state.lastAction.changedIds);
        const skipped = outcome.state.lastAction.skippedIds.length;
        const failed = outcome.state.lastAction.failedIds.length;
        const suffix = skipped || failed ? ` · ${skipped ? `${skipped} locked skipped` : ''}${skipped && failed ? ', ' : ''}${failed ? `${failed} failed` : ''}` : '';
        notify(`${outcome.state.lastAction.label}${suffix}`, skipped || failed ? 'warning' : successKind);
      }
    }
    return true;
  }, [commit, markPulse, notify]);

  const currentDocument = state.document;
  const activePage = getPage(currentDocument);
  const activeArtboards = useMemo(() => getArtboards(currentDocument), [currentDocument]);
  const assets = useMemo(() => Object.values(currentDocument.assets).sort((a, b) => a.originalName.localeCompare(b.originalName)), [currentDocument.assets]);
  const selectedNodes = useMemo(() => currentDocument.selection.ids.map((id) => currentDocument.nodes[id]).filter((node): node is DesignNode => Boolean(node)), [currentDocument]);
  const primaryNode = currentDocument.selection.primaryId ? currentDocument.nodes[currentDocument.selection.primaryId] : undefined;
  const selectedDesign = primaryNode
    ? primaryNode.type === 'artboard' ? primaryNode : getArtboardForNode(currentDocument, primaryNode.id)
    : undefined;
  const activeDesign = useMemo(
    () => selectedDesign ?? activeArtboards.find((design) => design.id === lastActiveDesignId) ?? activeArtboards[0],
    [activeArtboards, lastActiveDesignId, selectedDesign],
  );

  const stageSize = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? Math.max(700, window.innerWidth - 560), height: rect?.height ?? Math.max(420, window.innerHeight - 140) };
  }, []);

  const requestLayerReveal = useCallback((ids: string[]) => {
    const current = stateRef.current;
    const displayIds = feedbackDisplayIds(current.document, ids);
    if (!displayIds.length) return;
    const design = displayIds
      .map((id) => current.document.nodes[id])
      .map((node) => node ? node.type === 'artboard' ? node : getArtboardForNode(current.document, node.id) : undefined)
      .find((candidate): candidate is DesignNode => Boolean(candidate && candidate.pageId === current.document.activePageId));
    if (design) setLastActiveDesignId(design.id);
    revealTokenRef.current += 1;
    setLayerRevealRequest({ token: revealTokenRef.current, ids: displayIds });
  }, []);

  const ensureNodeVisible = useCallback((ids: string[]) => {
    const current = stateRef.current;
    const id = ids.find((candidate) => Boolean(current.document.nodes[candidate]));
    if (!id) return;
    const size = stageSize();
    const viewport = viewportKeepingNodeVisible(current.document, id, size.width, size.height);
    if (viewport) commit(dispatchCommand(current, { type: 'set-viewport', viewport }));
  }, [commit, stageSize]);

  const revealTargets = useCallback((ids: string[]) => {
    requestLayerReveal(ids);
    ensureNodeVisible(ids);
  }, [ensureNodeVisible, requestLayerReveal]);

  const beginAgentWork = useCallback((ids: string[]) => {
    const token = createId('agent_work');
    const displayIds = feedbackDisplayIds(stateRef.current.document, ids);
    const entry = {
      ids: displayIds,
      startedAt: Date.now(),
      safetyTimer: 0,
    };
    entry.safetyTimer = window.setTimeout(() => {
      if (!agentWorkRef.current.has(token)) return;
      agentWorkRef.current.delete(token);
      setAgentWorkingIds((current) => current.filter((id) => !displayIds.includes(id) || [...agentWorkRef.current.values()].some((work) => work.ids.includes(id))));
    }, 15000);
    agentWorkRef.current.set(token, entry);
    setAgentWorkingIds((current) => [...new Set([...current, ...displayIds])]);
    return token;
  }, []);

  const completeAgentWork = useCallback((token: string, ids: string[], success: boolean, mutation: boolean) => {
    const entry = agentWorkRef.current.get(token);
    if (!entry) return;
    if (entry.finishTimer) window.clearTimeout(entry.finishTimer);
    const finish = () => {
      if (!agentWorkRef.current.has(token)) return;
      agentWorkRef.current.delete(token);
      window.clearTimeout(entry.safetyTimer);
      const allIds = [...new Set([...entry.ids, ...feedbackDisplayIds(stateRef.current.document, ids)])];
      setAgentWorkingIds((current) => current.filter((id) => !allIds.includes(id) || [...agentWorkRef.current.values()].some((work) => work.ids.includes(id))));
      if (success && mutation) markPulse(allIds);
      if (allIds.length) revealTargets(allIds);
    };
    const remaining = Math.max(0, 650 - (Date.now() - entry.startedAt));
    if (remaining) entry.finishTimer = window.setTimeout(finish, remaining);
    else finish();
  }, [markPulse, revealTargets]);

  useEffect(() => () => {
    agentWorkRef.current.forEach((entry) => {
      window.clearTimeout(entry.safetyTimer);
      if (entry.finishTimer) window.clearTimeout(entry.finishTimer);
    });
    agentWorkRef.current.clear();
  }, []);

  useEffect(() => {
    if (!selectedDesign || selectedDesign.pageId !== currentDocument.activePageId) return;
    setLastActiveDesignId((current) => current === selectedDesign.id ? current : selectedDesign.id);
  }, [currentDocument.activePageId, selectedDesign]);

  const leftPanelBounds = getLeftPanelBounds(editorViewportWidth);
  const leftPanelWidth = clampLeftPanelWidth(state.panels.leftWidth, editorViewportWidth);
  const setLeftPanelWidth = useCallback((width: number) => {
    const current = stateRef.current;
    const nextWidth = clampLeftPanelWidth(width, editorViewportWidth);
    if (nextWidth === current.panels.leftWidth) return;
    commit({ ...current, panels: { ...current.panels, leftWidth: nextWidth } });
  }, [commit, editorViewportWidth]);

  const startLeftPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    panelResizeRef.current = { startX: event.clientX, startWidth: leftPanelWidth };
    setPanelResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [leftPanelWidth]);

  const handleLeftPanelResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 32 : 8;
    const currentWidth = clampLeftPanelWidth(stateRef.current.panels.leftWidth, editorViewportWidth);
    setLeftPanelWidth(currentWidth + (event.key === 'ArrowLeft' ? -step : step));
  }, [editorViewportWidth, setLeftPanelWidth]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;
      event.preventDefault();
      setLeftPanelWidth(resize.startWidth + event.clientX - resize.startX);
    };
    const onUp = () => {
      if (!panelResizeRef.current) return;
      panelResizeRef.current = null;
      setPanelResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setLeftPanelWidth]);

  useEffect(() => {
    if (!loaded || initialFitRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      initialFitRef.current = true;
      const current = stateRef.current;
      const targetIds = getArtboards(current.document).map((frame) => frame.id);
      if (!targetIds.length) return;
      const size = stageSize();
      const visibleWidth = current.panels.rightOpen && current.document.selection.primaryId ? Math.max(1, size.width - 310) : size.width;
      const viewport = computeFitViewport(current.document, targetIds, visibleWidth, size.height, 1.08);
      if (viewport) commit(dispatchCommand(current, { type: 'set-viewport', viewport }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commit, loaded, stageSize]);

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    const viewport = stateRef.current.document.viewport;
    return { x: (clientX - (rect?.left ?? 0) - viewport.pan.x) / viewport.zoom, y: (clientY - (rect?.top ?? 0) - viewport.pan.y) / viewport.zoom };
  }, []);

  const focusForInspection = useCallback(async (ids: string[]) => {
    const current = stateRef.current;
    const dimensions = stageSize();
    const viewport = computeFitViewport(current.document, ids, dimensions.width, dimensions.height, 1.15);
    if (!viewport) return { ok: false, message: 'The requested elements could not be measured.', targetIds: ids };
    const targetPageId = ids.map((id) => current.document.nodes[id]?.pageId).find((pageId): pageId is string => Boolean(pageId)) ?? current.document.activePageId;
    const next: EditorState = {
      ...current,
      document: { ...current.document, activePageId: targetPageId, viewport },
      panels: { ...current.panels, leftOpen: false, rightOpen: false },
      focus: { targetIds: [...ids], previousPageId: current.document.activePageId, previousViewport: deepClone(current.document.viewport), previousPanels: deepClone(current.panels), startedAt: Date.now() },
    };
    commit(next);
    return { ok: true, message: 'Inspection focus is active. Press Escape to restore the prior view.', targetIds: ids, viewport };
  }, [commit, stageSize]);

  const exitFocus = useCallback(() => {
    const current = stateRef.current;
    if (!current.focus) return;
    commit({ ...current, document: { ...current.document, activePageId: current.focus.previousPageId, viewport: deepClone(current.focus.previousViewport) }, panels: deepClone(current.focus.previousPanels), focus: null });
  }, [commit]);

  const toggleCanvasFocus = useCallback(() => {
    const current = stateRef.current;
    if (current.focus) {
      exitFocus();
      return;
    }
    commit({ ...current, panels: { ...current.panels, leftOpen: false, rightOpen: false }, focus: { targetIds: [], previousPageId: current.document.activePageId, previousViewport: deepClone(current.document.viewport), previousPanels: deepClone(current.panels), startedAt: Date.now() } });
  }, [commit, exitFocus]);

  const fitIds = useCallback((ids: string[]) => {
    const dimensions = stageSize();
    const viewport = computeFitViewport(stateRef.current.document, ids, dimensions.width, dimensions.height, 1.1);
    if (viewport) commit(dispatchCommand(stateRef.current, { type: 'set-viewport', viewport }));
  }, [commit, stageSize]);

  const fitSelection = useCallback(() => {
    const ids = stateRef.current.document.selection.ids;
    fitIds(ids.length ? ids : getPageNodeIds(stateRef.current.document));
  }, [fitIds]);

  const zoomAt = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const current = stateRef.current;
    const stage = stageRef.current?.getBoundingClientRect();
    const zoom = clamp(nextZoom, 0.18, 3);
    if (!stage || clientX === undefined || clientY === undefined) {
      commit(dispatchCommand(current, { type: 'set-viewport', viewport: { ...current.document.viewport, zoom } }));
      return;
    }
    const cursor = { x: clientX - stage.left, y: clientY - stage.top };
    const world = { x: (cursor.x - current.document.viewport.pan.x) / current.document.viewport.zoom, y: (cursor.y - current.document.viewport.pan.y) / current.document.viewport.zoom };
    const pan = { x: cursor.x - world.x * zoom, y: cursor.y - world.y * zoom };
    commit(dispatchCommand(current, { type: 'set-viewport', viewport: { zoom, pan } }));
  }, [commit]);

  const closePreview = useCallback(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    commit({ ...stateRef.current, preview: null });
  }, [commit]);

  const captureForTool = useCallback(async (frameId: string, scale: 1 | 2, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('The tool call was cancelled.');
    const prepared = await prepareArtboardExport(stateRef.current.document, frameId, 'png', scale);
    if (signal?.aborted) throw new Error('The tool call was cancelled.');
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(prepared.blob);
    previewUrlRef.current = url;
    const current = stateRef.current;
    const preview: PreviewState = { kind: 'frame', title: current.document.nodes[frameId]?.name ?? 'Frame preview', imageUrl: url, artboardId: frameId, width: prepared.width, height: prepared.height, scale, snapshotId: snapshotId() };
    commit({ ...current, preview });
    notify('Frame preview opened for inspection.', 'success');
    return { ok: true, message: 'PNG preview is open.', snapshotId: preview.snapshotId, frameId, dimensions: { width: prepared.width, height: prepared.height }, scale, previewOpen: true, unsupportedStyles: prepared.unsupported };
  }, [commit, notify]);

  const exportForTool = useCallback(async (frameIds: string[], format: ExportFormat, scale: 1 | 2, signal?: AbortSignal) => {
    const current = stateRef.current;
    const nodes = frameIds.map((id) => current.document.nodes[id]);
    if (nodes.some((node) => !node || node.type !== 'artboard')) throw new Error('Every export ID must reference an existing Frame.');
    const preparedItems = [] as Array<{ fileName: string; bytes: number; frameId?: string; frameName?: string; width?: number; height?: number; unsupported: string[] }>;
    const ids = format === 'json' ? [frameIds[0]] : frameIds;
    for (const id of ids) {
      if (signal?.aborted) throw new Error('The tool call was cancelled.');
      const prepared = await prepareArtboardExport(current.document, id, format, scale);
      downloadBlob(prepared.blob, prepared.fileName);
      preparedItems.push({ fileName: prepared.fileName, bytes: prepared.blob.size, frameId: prepared.frameId, frameName: current.document.nodes[id]?.name, width: prepared.width, height: prepared.height, unsupported: prepared.unsupported });
    }
    notify(`Prepared ${preparedItems.length} ${format.toUpperCase()} export${preparedItems.length === 1 ? '' : 's'}.`, 'success');
    return { ok: true, message: `Prepared ${preparedItems.length} export file${preparedItems.length === 1 ? '' : 's'}.`, format, scale, files: preparedItems, exportReady: true };
  }, [notify]);

  const importImage = useCallback(async (file: File, sourceLabel = 'Uploaded') => {
    try {
      const asset = await readImageAsset(file, sourceLabel);
      const existing = Object.values(stateRef.current.document.assets).find((candidate) => candidate.dataUrl === asset.dataUrl);
      if (!runCommand({ type: 'import-asset', asset, source: 'human' }, 'success')) return;
      setSelectedAssetId(existing?.id ?? asset.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The image could not be added.', 'error');
    }
  }, [notify, runCommand]);

  const pasteAssetFromClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard?.read) throw new Error('Clipboard image access is unavailable in this browser.');
      const items = await navigator.clipboard.read();
      const type = items.flatMap((item) => item.types).find((candidate) => candidate.startsWith('image/'));
      if (!type) throw new Error('Copy an image before using Paste.');
      const blob = await items.find((item) => item.types.includes(type))?.getType(type);
      if (!blob) throw new Error('The clipboard image could not be read.');
      void importImage(new File([blob], `Pasted image.${type.split('/')[1] ?? 'png'}`, { type }), 'Pasted');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The clipboard image could not be added.', 'error');
    }
  }, [importImage, notify]);

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].filter((file) => file.type.startsWith('image/'));
    files.forEach((file) => void importImage(file, 'Uploaded'));
    event.target.value = '';
  }, [importImage]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const items = [...(event.clipboardData?.items ?? [])];
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        void importImage(file, 'Pasted');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [importImage]);

  const copySelection = useCallback(() => {
    const ids = stateRef.current.document.selection.ids;
    if (!ids.length) return;
    clipboardIdsRef.current = [...ids];
    void navigator.clipboard?.writeText(JSON.stringify({ ids })).catch(() => undefined);
    notify(`${ids.length} element${ids.length === 1 ? '' : 's'} copied.`, 'success');
  }, [notify]);

  const pasteSelection = useCallback(() => {
    if (!clipboardIdsRef.current.length) {
      notify('Copy an element in this File before pasting.', 'warning');
      return;
    }
    runCommand({ type: 'duplicate-elements', ids: clipboardIdsRef.current, offset: { x: 32, y: 32 }, source: 'human' }, 'success');
  }, [notify, runCommand]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      if (stateRef.current.preview) {
        event.preventDefault();
        closePreview();
        return;
      }
      if (stateRef.current.focus) {
        event.preventDefault();
        setEditingNodeId(null);
        exitFocus();
        return;
      }
      if (!stateRef.current.panels.leftOpen || !stateRef.current.panels.rightOpen) {
        event.preventDefault();
        commit({ ...stateRef.current, panels: { ...stateRef.current.panels, leftOpen: true, rightOpen: true } });
      }
      return;
    }
    if (isTypingTarget(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && key === 'z') {
      event.preventDefault();
      runCommand({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      runCommand({ type: 'redo' });
      return;
    }
    if (modifier && key === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (modifier && key === 'v') {
      event.preventDefault();
      pasteSelection();
      return;
    }
    if (modifier && key === 'd') {
      event.preventDefault();
      runCommand({ type: 'duplicate-elements', ids: stateRef.current.document.selection.ids, source: 'human' }, 'success');
      return;
    }
    if (modifier && key === 'g') {
      event.preventDefault();
      runCommand({ type: event.shiftKey ? 'ungroup-elements' : 'group-elements', ids: stateRef.current.document.selection.ids, source: 'human' });
      return;
    }
    if (modifier && event.key === '\\') {
      event.preventDefault();
      toggleCanvasFocus();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt(stateRef.current.document.viewport.zoom + 0.1);
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      zoomAt(stateRef.current.document.viewport.zoom - 0.1);
      return;
    }
    if (event.key === '0') {
      event.preventDefault();
      zoomAt(1);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (stateRef.current.document.selection.ids.length) {
        event.preventDefault();
        runCommand({ type: 'delete-elements', ids: stateRef.current.document.selection.ids, source: 'human' });
      }
      return;
    }
    if (event.key.startsWith('Arrow')) {
      const amount = event.shiftKey ? 8 : 1;
      const delta: Point = event.key === 'ArrowLeft' ? { x: -amount, y: 0 } : event.key === 'ArrowRight' ? { x: amount, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -amount } : { x: 0, y: amount };
      const updates: ElementPatch[] = stateRef.current.document.selection.ids.flatMap((id) => {
        const node = stateRef.current.document.nodes[id];
        return node ? [{ id, x: node.x + delta.x, y: node.y + delta.y }] : [];
      });
      if (updates.length) {
        event.preventDefault();
        runCommand({ type: 'update-elements', updates, source: 'human' });
      }
    }
  }, [closePreview, commit, copySelection, exitFocus, notify, pasteSelection, runCommand, toggleCanvasFocus, zoomAt]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === 'pan') {
        const current = stateRef.current;
        commit(dispatchCommand(current, { type: 'set-viewport', viewport: { ...current.document.viewport, pan: { x: drag.startPan.x + event.clientX - drag.startX, y: drag.startPan.y + event.clientY - drag.startY } } }));
        return;
      }
      const zoom = stateRef.current.document.viewport.zoom;
      const delta = { x: (event.clientX - drag.startX) / zoom, y: (event.clientY - drag.startY) / zoom };
      const previewNext = (next: Record<string, PreviewTransform>) => {
        dragPreviewRef.current = next;
        if (dragFrameRef.current !== null) return;
        dragFrameRef.current = window.requestAnimationFrame(() => {
          dragFrameRef.current = null;
          setDragPreview(dragPreviewRef.current);
        });
      };
      if (drag.kind === 'move') {
        const next: Record<string, PreviewTransform> = {};
        drag.ids.forEach((id) => {
          const base = drag.base[id];
          if (base) next[id] = { ...base, x: base.x + delta.x, y: base.y + delta.y };
        });
        previewNext(next);
      } else if (drag.kind === 'resize') {
        const base = drag.base;
        const resizeNode = stateRef.current.document.nodes[drag.nodeId];
        let x = base.x;
        let y = base.y;
        let width = base.width;
        let height = base.height;
        if (drag.corner.includes('e')) width = Math.max(20, base.width + delta.x);
        if (drag.corner.includes('w')) { width = Math.max(20, base.width - delta.x); x = base.x + base.width - width; }
        if (drag.corner.includes('s')) height = Math.max(20, base.height + delta.y);
        if (resizeNode?.type === 'text' && width !== base.width) height = measureTextBoxHeight(resizeNode, width);
        if (drag.corner.includes('n')) y = base.y + base.height - height;
        previewNext({ [drag.nodeId]: { ...base, x, y, width, height } });
      } else if (drag.kind === 'rotate') {
        const point = screenToWorld(event.clientX, event.clientY);
        const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180 / Math.PI;
        const startAngle = Math.atan2(screenToWorld(drag.startX, drag.startY).y - drag.center.y, screenToWorld(drag.startX, drag.startY).x - drag.center.x) * 180 / Math.PI;
        previewNext({ [drag.nodeId]: { ...drag.base, rotation: drag.base.rotation + angle - startAngle } });
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragging(false);
      const preview = dragPreviewRef.current;
      if (drag.kind === 'move') {
        const updates: ElementPatch[] = drag.ids.flatMap((id) => preview[id] ? [{ id, x: preview[id].x, y: preview[id].y }] : []);
        if (updates.length) runCommand({ type: 'update-elements', updates, source: 'human' }, 'success');
      } else if (drag.kind === 'resize' && preview[drag.nodeId]) {
        const target = preview[drag.nodeId];
        runCommand({ type: 'update-elements', updates: [{ id: drag.nodeId, x: target.x, y: target.y, width: target.width, height: target.height }], source: 'human' }, 'success');
      } else if (drag.kind === 'rotate' && preview[drag.nodeId]) {
        runCommand({ type: 'update-elements', updates: [{ id: drag.nodeId, rotation: preview[drag.nodeId].rotation }], source: 'human' }, 'success');
      }
      dragPreviewRef.current = {};
      setDragPreview({});
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [commit, runCommand, screenToWorld]);

  const startMove = useCallback((nodeId: string, event: ReactPointerEvent) => {
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = stateRef.current;
    const shift = event.shiftKey;
    const selected = shift
      ? current.document.selection.ids.includes(nodeId)
        ? current.document.selection.ids.filter((id) => id !== nodeId)
        : [...current.document.selection.ids, nodeId]
      : [nodeId];
    commit(dispatchCommand(current, { type: 'set-selection', ids: selected }));
    revealTargets(selected);
    if (!selected.length) return;
    if (selected.some((id) => isEffectivelyLocked(current.document, id))) {
      notify('Locked Layers cannot be moved.', 'warning');
      return;
    }
    const base: Record<string, PreviewTransform> = {};
    selected.forEach((id) => {
      const node = current.document.nodes[id];
      if (node) base[id] = { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
    });
    dragRef.current = { kind: 'move', startX: event.clientX, startY: event.clientY, ids: selected, base };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }, [commit, notify, revealTargets, tool]);

  const startPan = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || tool !== 'pan') return;
    event.preventDefault();
    dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, startPan: deepClone(stateRef.current.document.viewport.pan) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }, [tool]);

  const startResize = useCallback((nodeId: string, corner: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = stateRef.current.document.nodes[nodeId];
    if (!node) return;
    if (isEffectivelyLocked(stateRef.current.document, nodeId)) return;
    dragRef.current = { kind: 'resize', startX: event.clientX, startY: event.clientY, nodeId, corner, base: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }, []);

  const startRotate = useCallback((nodeId: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = stateRef.current.document.nodes[nodeId];
    if (!node) return;
    if (isEffectivelyLocked(stateRef.current.document, nodeId)) return;
    const rect = getAbsoluteRect(stateRef.current.document, nodeId);
    dragRef.current = { kind: 'rotate', startX: event.clientX, startY: event.clientY, nodeId, base: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation }, center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  }, []);

  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('.frame-quick-create, .shapes-menu')) return;
    if (tool === 'pan') {
      startPan(event);
      return;
    }
    if (tool === 'select' && event.target !== event.currentTarget && !target.classList.contains('world')) return;
    const world = screenToWorld(event.clientX, event.clientY);
    const current = stateRef.current;
    if (tool === 'select') {
      runCommand({ type: 'set-selection', ids: [] });
      return;
    }
    if (tool === 'add-frame') {
      const preset: ArtboardPreset = 'website';
      const size = { width: 880, height: 600 };
      const input: CreateArtboardInput = { name: 'Website', preset, position: { x: world.x - size.width / 2, y: world.y - size.height / 2 } };
      runCommand({ type: 'create-artboard', ...input, source: 'human' }, 'success');
      setTool('select');
      return;
    }
    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'polygon' || tool === 'text') {
      const frame = getFrameAtPoint(current.document, world);
      const framePosition = frame ? getAbsolutePosition(current.document, frame.id) : undefined;
      const x = framePosition ? world.x - framePosition.x : world.x;
      const y = framePosition ? world.y - framePosition.y : world.y;
      const spec: ElementSpec = tool === 'text'
        ? { type: 'text', name: 'Text', content: 'Type something', x, y, width: 280, height: 52, style: { fontSize: 28, fontWeight: 500 } }
        : tool === 'ellipse'
          ? { type: 'ellipse', name: 'Ellipse', x, y, width: 180, height: 120, style: { fill: '#deded9', borderRadius: 90 } }
          : tool === 'line'
            ? { type: 'line', name: 'Line', x, y, width: 220, height: 4, style: { fill: 'transparent', borderColor: '#171717', borderWidth: 2 } }
            : tool === 'arrow'
              ? { type: 'arrow', name: 'Arrow', x, y, width: 220, height: 24, style: { fill: 'transparent', borderColor: '#171717', borderWidth: 2 } }
              : tool === 'polygon'
                ? { type: 'polygon', name: 'Polygon', x, y, width: 160, height: 160, shape: { sides: 6 }, style: { fill: '#deded9', borderRadius: 0 } }
                : { type: 'rectangle', name: 'Rectangle', x, y, width: 180, height: 120, style: { fill: '#deded9', borderRadius: 12 } };
      runCommand({ type: 'insert-elements', ...(frame ? { frameId: frame.id } : { pageId: current.document.activePageId }), elements: [spec], source: 'human' }, 'success');
      setTool('select');
      setShapeMenuOpen(false);
      return;
    }
  }, [runCommand, screenToWorld, startPan, tool]);

  const handleStageDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const assetId = event.dataTransfer.getData('application/x-easel-asset');
    if (!assetId) return;
    event.preventDefault();
    const asset = stateRef.current.document.assets[assetId];
    if (!asset) return;
    const world = screenToWorld(event.clientX, event.clientY);
    const frame = getFrameAtPoint(stateRef.current.document, world);
    if (!frame) {
      notify('Drop an Asset inside a Frame to place it.', 'warning');
      return;
    }
    const width = Math.min(360, Math.max(140, asset.naturalWidth));
    const height = width / (asset.aspectRatio || 1);
    const framePosition = getAbsolutePosition(stateRef.current.document, frame.id);
    runCommand({ type: 'place-asset', assetId, frameId: frame.id, position: { x: world.x - framePosition.x - width / 2, y: world.y - framePosition.y - height / 2 }, width, height, source: 'human' }, 'success');
  }, [notify, runCommand, screenToWorld]);

  const handleStageDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('application/x-easel-asset')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const current = stateRef.current.document.viewport;
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(current.zoom * factor, event.clientX, event.clientY);
  }, [zoomAt]);

  const selectNode = useCallback((id: string, additive = false) => {
    if (runCommand({ type: 'set-selection', ids: [id], additive })) revealTargets([id]);
  }, [revealTargets, runCommand]);

  const selectDesign = useCallback((id: string) => {
    setLastActiveDesignId(id);
    if (runCommand({ type: 'set-selection', ids: [id] })) revealTargets([id]);
  }, [revealTargets, runCommand]);

  const commitText = useCallback((id: string, content: string) => {
    setEditingNodeId(null);
    const node = stateRef.current.document.nodes[id];
    runCommand({ type: 'update-elements', updates: [{ id, content, ...(node?.type === 'text' ? { height: measureTextBoxHeight(node, node.width, content) } : {}) }], source: 'human' }, 'success');
  }, [runCommand]);

  const switchFile = useCallback((fileId: string) => {
    const current = syncActiveFile(stateRef.current);
    const file = current.files.find((candidate) => candidate.id === fileId);
    if (!file) {
      notify('That File is no longer available.', 'error');
      return;
    }
    commit({ ...current, activeFileId: file.id, document: deepClone(file.document), files: current.files.map((candidate) => candidate.id === file.id ? { ...candidate, open: true } : candidate), history: [], future: [], lastAction: null, focus: null, preview: null });
    setExportOpen(false);
    setSelectedAssetId(null);
  }, [commit, notify]);

  const renameActiveFile = useCallback(() => {
    const current = stateRef.current;
    const nextName = window.prompt('Rename File', current.document.name);
    if (!nextName?.trim()) return;
    runCommand({ type: 'set-document-name', name: nextName.trim(), source: 'human' }, 'success');
  }, [runCommand]);

  const createNewFile = useCallback(() => {
    const name = window.prompt('New File name', 'Untitled File')?.trim();
    if (!name) return;
    const current = syncActiveFile(stateRef.current);
    const document = createInitialDocument();
    document.id = createId('document');
    document.name = name;
    document.pages = [{ id: 'page_canvas', name: 'Canvas', rootIds: [] }];
    document.activePageId = 'page_canvas';
    document.nodes = {};
    document.assets = {};
    document.selection = { ids: [], primaryId: null };
    document.revision = 1;
    document.updatedAt = nowIso();
    const fileId = createId('file');
    const file = { id: fileId, name, document: deepClone(document), updatedAt: document.updatedAt, open: true };
    commit({ ...current, activeFileId: fileId, document, files: [...current.files, file], history: [], future: [], lastAction: null, focus: null, preview: null });
    notify(`Created ${name}`, 'success');
  }, [commit, notify]);

  useEffect(() => {
    if (!loaded) return;
    let cleanup: (() => void) | undefined;
    void registerWebMCPTools({
      getState: () => stateRef.current,
      commit,
      focus: focusForInspection,
      capture: captureForTool,
      export: exportForTool,
      openFile: async (target) => {
        const matches = stateRef.current.files.filter((candidate) => target.fileId ? candidate.id === target.fileId : candidate.name.trim().toLowerCase() === target.fileName?.trim().toLowerCase());
        if (matches.length !== 1) throw new Error(matches.length ? 'More than one File has that name.' : 'No saved File matched that exact target.');
        const file = matches[0];
        switchFile(file.id);
        return { ok: true, message: `Opened ${file.name}`, fileId: file.id, fileName: file.name };
      },
      beginAgentWork,
      completeAgentWork,
      reveal: revealTargets,
    }).then((result) => { cleanup = result.cleanup; });
    return () => cleanup?.();
  }, [beginAgentWork, captureForTool, commit, completeAgentWork, exportForTool, focusForInspection, loaded, revealTargets, switchFile]);

  if (!loaded) return <div className="loading-shell" aria-label="Loading Easel"><span className="loading-mark" /><span>Easel</span></div>;

  return (
    <div className={`app-shell theme-${state.theme}`} data-theme={state.theme}>
      <div className="workspace" ref={workspaceRef}>
        {!state.panels.leftOpen && <button className="sidebar-reopen" type="button" aria-label="Show Layers panel" title="Show Layers panel" onClick={() => commit({ ...stateRef.current, panels: { ...stateRef.current.panels, leftOpen: true } })}><PanelLeft size={16} /></button>}
        {state.panels.leftOpen && <LeftPanel width={leftPanelWidth} resizeActive={panelResizing} resizeMin={leftPanelBounds.minimum} resizeMax={leftPanelBounds.maximum} onResizeStart={startLeftPanelResize} onResizeKeyDown={handleLeftPanelResizeKeyDown} files={state.files} activeFileId={state.activeFileId} onSwitchFile={switchFile} onNewFile={createNewFile} onRenameFile={renameActiveFile} theme={state.theme} onTheme={(theme) => commit({ ...stateRef.current, theme })} document={currentDocument} designs={activeArtboards} activeDesign={activeDesign} assets={assets} selectedAssetId={selectedAssetId} onSelectAsset={setSelectedAssetId} onUploadAssets={() => fileInputRef.current?.click()} onPasteAsset={pasteAssetFromClipboard} selectedIds={currentDocument.selection.ids} workingIds={agentWorkingIds} pulseIds={pulseIds} revealRequest={layerRevealRequest} onSelect={selectNode} onSelectDesign={selectDesign} onToggleHidden={(id) => runCommand({ type: 'toggle-hidden', ids: [id], source: 'human' })} onToggleLocked={(id) => runCommand({ type: 'toggle-locked', ids: [id], source: 'human' })} onReorderLayer={(id, beforeId) => runCommand({ type: 'reorder-layer', id, beforeId, source: 'human' }, 'success')} onCollapse={() => commit({ ...stateRef.current, panels: { ...stateRef.current.panels, leftOpen: false } })} />}
        <ToolRail tool={tool} onTool={(nextTool) => { setTool(nextTool); if (nextTool !== 'rectangle' && nextTool !== 'ellipse' && nextTool !== 'line' && nextTool !== 'arrow' && nextTool !== 'polygon') setShapeMenuOpen(false); }} shapeMenuOpen={shapeMenuOpen} onShapeMenu={() => setShapeMenuOpen((open) => !open)} onFit={fitSelection} leftOpen={state.panels.leftOpen} canUndo={Boolean(state.history.length)} canRedo={Boolean(state.future.length)} onUndo={() => runCommand({ type: 'undo' })} onRedo={() => runCommand({ type: 'redo' })} />
        <main className="canvas-main">
          <div className={`canvas-stage ${dragging ? 'is-dragging' : ''}`} ref={stageRef} onPointerDown={handleStagePointerDown} onWheel={handleWheel} onDrop={handleStageDrop} onDragOver={handleStageDragOver} tabIndex={0} aria-label="Canvas">
            {tool === 'add-frame' && <FrameQuickCreate onCreate={(input) => { const dimensions = stageRef.current?.getBoundingClientRect(); const center = dimensions ? screenToWorld(dimensions.left + dimensions.width / 2, dimensions.top + dimensions.height / 2) : { x: 600, y: 400 }; const size = input.preset === 'website-mobile' ? { width: 390, height: 844 } : input.preset === 'graphic' ? { width: 480, height: 600 } : { width: 880, height: 600 }; const position = { x: center.x - (input.width ?? size.width) / 2, y: center.y - (input.height ?? size.height) / 2 }; runCommand({ type: 'create-artboard', ...input, position, source: 'human' }, 'success'); setTool('select'); }} />}
            <div className="world" style={{ transform: `translate(${state.document.viewport.pan.x}px, ${state.document.viewport.pan.y}px) scale(${state.document.viewport.zoom})` }}>
              {activePage?.rootIds.map((id) => <NodeRenderer key={id} id={id} document={currentDocument} tool={tool} selectedIds={currentDocument.selection.ids} editingNodeId={editingNodeId} pulseIds={pulseIds} workingIds={agentWorkingIds} focusIds={state.focus?.targetIds ?? []} preview={dragPreview} onPointerDown={startMove} onDoubleClick={(id) => setEditingNodeId(id)} onCommitText={commitText} onSelect={selectNode} />)}
              <SelectionLayer document={currentDocument} selectedIds={currentDocument.selection.ids} preview={dragPreview} onResize={startResize} onRotate={startRotate} />
            </div>
            {state.focus && <div className="focus-hint"><Scan size={13} />Esc to exit focus</div>}
            <div className="stage-empty-hint" aria-hidden="true">{activePage?.rootIds.length ? '' : 'Choose a tool to start placing elements'}</div>
            {primaryNode && !state.panels.rightOpen && <button className="inspector-reopen" type="button" onClick={() => commit({ ...stateRef.current, panels: { ...stateRef.current.panels, rightOpen: true } })}>Show Inspector</button>}
          </div>
        </main>
        {state.panels.rightOpen && primaryNode && <Inspector node={primaryNode} selectedCount={selectedNodes.length} document={currentDocument} frameId={selectedDesign?.id} exportOpen={exportOpen} exportArtboards={activeArtboards} exportIds={exportIds} exportFormat={exportFormat} exportScale={exportScale} onExportFormat={setExportFormat} onExportScale={setExportScale} onToggleExportFrame={(id) => setExportIds((ids) => ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id])} onCloseExport={() => setExportOpen(false)} onPrepareExport={() => { if (!exportIds.length) { notify('Choose at least one Frame.', 'warning'); return; } void exportForTool(exportIds, exportFormat, exportScale).then(() => setExportOpen(false)).catch((error) => notify(error instanceof Error ? error.message : 'Export failed.', 'error')); }} onClose={() => commit({ ...stateRef.current, panels: { ...stateRef.current.panels, rightOpen: false } })} onPreview={() => { if (selectedDesign) void captureForTool(selectedDesign.id, 1); else notify('Select a Frame or a Layer inside one first.', 'warning'); }} onExport={() => { if (selectedDesign) { setExportIds([selectedDesign.id]); setExportOpen(true); } else notify('Select a Frame or a Layer inside one first.', 'warning'); }} onUpdate={(updates) => runCommand({ type: 'update-elements', updates, source: 'human' }, 'success')} onToggleLocked={() => runCommand({ type: 'toggle-locked', ids: selectedNodes.map((node) => node.id), source: 'human' })} onDelete={() => runCommand({ type: 'delete-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onDuplicate={() => runCommand({ type: 'duplicate-elements', ids: selectedNodes.map((node) => node.id), source: 'human' }, 'success')} onAlign={(alignment) => runCommand({ type: 'align-elements', ids: selectedNodes.map((node) => node.id), alignment, source: 'human' })} onDistribute={(axis) => runCommand({ type: 'distribute-elements', ids: selectedNodes.map((node) => node.id), axis, source: 'human' })} onGroup={() => runCommand({ type: 'group-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onUngroup={() => runCommand({ type: 'ungroup-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onReorder={(direction) => runCommand({ type: 'reorder-elements', ids: selectedNodes.map((node) => node.id), direction, source: 'human' })} onReapply={() => { if (!primaryNode.binding?.sharedValue) return; runCommand({ type: 'apply-context', values: [{ key: primaryNode.binding.key, value: primaryNode.type === 'image' ? { assetId: primaryNode.binding.sharedValue } : primaryNode.binding.sharedValue }], source: 'human' }, 'success'); }} onUnbind={() => runCommand({ type: 'unbind-context', ids: [primaryNode.id], source: 'human' })} />}
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={handleFileSelection} />
      {toast && <Toast state={toast} />}
      {state.preview && <PreviewOverlay preview={state.preview} onClose={closePreview} onDownload={() => { const link = document.createElement('a'); link.href = state.preview?.imageUrl ?? ''; link.download = `${state.preview?.title ?? 'frame'}-${state.preview?.scale ?? 1}x.png`; link.click(); }} />}
    </div>
  );
}

type IconButtonProps = { label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean };

function IconButton({ label, children, onClick, disabled, active }: IconButtonProps) {
  return <button className={`icon-button ${active ? 'is-active' : ''}`} type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

type NodeRendererProps = {
  id: string;
  document: DocumentModel;
  tool: ToolName;
  selectedIds: string[];
  editingNodeId: string | null;
  pulseIds: string[];
  workingIds: string[];
  focusIds: string[];
  preview: Record<string, PreviewTransform>;
  onPointerDown: (id: string, event: ReactPointerEvent) => void;
  onDoubleClick: (id: string) => void;
  onCommitText: (id: string, content: string) => void;
  onSelect: (id: string, additive?: boolean) => void;
};

function NodeRenderer({ id, document, tool, selectedIds, editingNodeId, pulseIds, workingIds, focusIds, preview, onPointerDown, onDoubleClick, onCommitText }: NodeRendererProps) {
  const node = document.nodes[id];
  const textRef = useRef<HTMLDivElement | null>(null);
  if (!node || node.hidden) return null;
  const parent = node.parentId ? document.nodes[node.parentId] : undefined;
  const flexChild = Boolean(parent?.layout && parent.layout.mode !== 'free');
  const transform = preview[node.id];
  const x = transform?.x ?? node.x;
  const y = transform?.y ?? node.y;
  const width = transform?.width ?? node.width;
  const height = transform?.height ?? node.height;
  const rotation = transform?.rotation ?? node.rotation;
  const vectorShape = node.type === 'polygon' || node.type === 'line' || node.type === 'arrow';
  const style: CSSProperties = {
    position: flexChild ? 'relative' : 'absolute',
    left: flexChild ? undefined : x,
    top: flexChild ? undefined : y,
    width,
    height,
    flex: flexChild ? `0 0 ${width}px` : undefined,
    background: node.type === 'text' || vectorShape ? 'transparent' : node.style.fill,
    border: vectorShape ? '0' : `${node.style.borderWidth}px ${node.style.borderStyle} ${node.style.borderColor}`,
    borderRadius: node.type === 'ellipse' ? '50%' : node.style.borderRadius,
    opacity: node.style.opacity,
    color: node.style.color,
    fontFamily: node.style.fontFamily,
    fontSize: node.style.fontSize,
    fontWeight: node.style.fontWeight,
    lineHeight: node.style.lineHeight,
    letterSpacing: node.style.letterSpacing,
    textAlign: node.style.textAlign,
    transform: `rotate(${rotation}deg)`,
    transformOrigin: 'center center',
    overflow: node.layout?.clipContent ? 'hidden' : 'visible',
    display: node.type === 'frame' || node.type === 'artboard' ? (node.layout?.mode === 'flex-row' ? 'flex' : node.layout?.mode === 'flex-column' ? 'flex' : 'block') : undefined,
    flexDirection: node.layout?.mode === 'flex-row' ? 'row' : node.layout?.mode === 'flex-column' ? 'column' : undefined,
    gap: node.layout && node.layout.mode !== 'free' ? node.layout.gap : undefined,
    padding: node.layout && node.layout.mode !== 'free' ? node.layout.padding : undefined,
    alignItems: node.layout && node.layout.mode !== 'free' ? node.layout.alignItems : undefined,
    justifyContent: node.layout && node.layout.mode !== 'free' ? node.layout.justifyContent : undefined,
    zIndex: node.type === 'artboard' ? 1 : undefined,
  };
  const className = ['canvas-node', `node-${node.type}`, selectedIds.includes(node.id) ? 'is-selected' : '', pulseIds.includes(node.id) ? 'is-pulsing' : '', workingIds.includes(node.id) ? node.type === 'artboard' ? 'is-agent-working-design' : 'is-agent-working-node' : '', focusIds.includes(node.id) ? 'is-focus-target' : '', node.locked ? 'is-locked' : ''].filter(Boolean).join(' ');
  const isEditing = editingNodeId === node.id && node.type === 'text';

  useEffect(() => {
    if (!isEditing || !textRef.current) return;
    textRef.current.focus();
    const selection = window.getSelection();
    const range = window.document.createRange();
    range.selectNodeContents(textRef.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [isEditing]);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isEditing) {
      event.stopPropagation();
      return;
    }
    onPointerDown(node.id, event);
  };

  const children = node.childIds.map((childId) => <NodeRenderer key={childId} id={childId} document={document} tool={tool} selectedIds={selectedIds} editingNodeId={editingNodeId} pulseIds={pulseIds} workingIds={workingIds} focusIds={focusIds} preview={preview} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onCommitText={onCommitText} onSelect={() => undefined} />);
  if (node.type === 'text') {
    return <div ref={textRef} className={className} data-node-id={node.id} data-node-type={node.type} aria-label={node.name} style={{ ...style, whiteSpace: 'pre-wrap', outline: isEditing ? '2px solid var(--color-active)' : undefined, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }} contentEditable={isEditing && !node.locked} suppressContentEditableWarning onBlur={(event) => { if (isEditing) onCommitText(node.id, event.currentTarget.textContent ?? ''); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.blur(); } }}>{node.content ?? ''}{children}</div>;
  }
  if (node.type === 'image') {
    const asset = node.image?.assetId ? document.assets[node.image.assetId] : undefined;
    return <div className={className} data-node-id={node.id} data-node-type={node.type} aria-label={node.image?.alt || node.name} style={{ ...style, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }}><ImageContent asset={asset} alt={node.image?.alt || node.name} label={node.image?.label || node.name} />{children}</div>;
  }
  return <div className={`${className} ${node.type === 'artboard' ? 'artboard-node' : node.type === 'frame' ? 'frame-node' : `${node.type}-node`}`} data-node-id={node.id} data-node-type={node.type === 'artboard' ? 'frame' : node.type} data-label={node.name} aria-label={`${nodeTypeLabel(node.type)} ${node.name}`} style={{ ...style, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }}>{vectorShape ? <ShapeVisual node={node} /> : null}{children}</div>;
}

function ShapeVisual({ node }: { node: DesignNode }) {
  const stroke = node.style.borderColor;
  const strokeWidth = Math.max(1, node.style.borderWidth);
  const dash = node.style.borderStyle === 'dashed' ? '8 6' : node.style.borderStyle === 'dotted' ? '2 5' : undefined;
  if (node.type === 'polygon') {
    const sides = Math.max(3, Math.min(12, Math.round(node.shape?.sides ?? 6)));
    const points = Array.from({ length: sides }, (_, index) => {
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / sides);
      return `${50 + 46 * Math.cos(angle)},${50 + 46 * Math.sin(angle)}`;
    }).join(' ');
    return <svg className="shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points} fill={node.style.fill} fillOpacity={node.style.opacity} stroke={stroke} strokeWidth={strokeWidth * 1.5} strokeDasharray={dash} strokeLinejoin="round" /></svg>;
  }
  if (node.type === 'arrow') return <svg className="shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="8" y1="50" x2="82" y2="50" stroke={stroke} strokeWidth={strokeWidth * 1.5} strokeDasharray={dash} strokeLinecap="round" /><path d="M70 30 L92 50 L70 70" fill="none" stroke={stroke} strokeWidth={strokeWidth * 1.5} strokeDasharray={dash} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg className="shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="5" y1="50" x2="95" y2="50" stroke={stroke} strokeWidth={strokeWidth * 1.5} strokeDasharray={dash} strokeLinecap="round" /></svg>;
}

function ImageContent({ asset, alt, label }: { asset?: ImageAsset; alt: string; label: string }) {
  if (!asset) return <div className="image-placeholder"><ImageIcon size={20} /><span>Image unavailable</span></div>;
  return <img className="node-image-content" src={asset.dataUrl} alt={alt} draggable={false} data-image-label={label} />;
}

type SelectionLayerProps = {
  document: DocumentModel;
  selectedIds: string[];
  preview: Record<string, PreviewTransform>;
  onResize: (id: string, corner: string, event: ReactPointerEvent) => void;
  onRotate: (id: string, event: ReactPointerEvent) => void;
};

function SelectionLayer({ document, selectedIds, preview, onResize, onRotate }: SelectionLayerProps) {
  const visibleIds = selectedIds.filter((id) => document.nodes[id] && !document.nodes[id].hidden);
  const boxes = visibleIds.map((id) => ({ id, rect: getLocalPreviewRect(document, id, preview) }));
  if (!boxes.length) return null;
  const union = boxes.reduce((result, item) => ({
    x: Math.min(result.x, item.rect.x),
    y: Math.min(result.y, item.rect.y),
    right: Math.max(result.right, item.rect.x + item.rect.width),
    bottom: Math.max(result.bottom, item.rect.y + item.rect.height),
  }), { x: boxes[0].rect.x, y: boxes[0].rect.y, right: boxes[0].rect.x + boxes[0].rect.width, bottom: boxes[0].rect.y + boxes[0].rect.height });
  const screenScale = 1 / Math.max(0.18, document.viewport.zoom);
  const primary = boxes.find((item) => item.id === document.selection.primaryId) ?? boxes[0];
  const single = boxes.length === 1;
  const primaryNode = document.nodes[primary.id];
  const renderHandles = single && primaryNode && !isEffectivelyLocked(document, primary.id);
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return <div className="selection-layer">
    {boxes.map(({ id, rect }) => <div key={id} className={`selection-box ${single && id === primary.id ? 'is-primary' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderWidth: 1.25 * screenScale, transform: `rotate(${rect.rotation}deg)` }} />)}
    <div className={`selection-union ${single ? 'is-single' : ''}`} style={{ left: union.x, top: union.y, width: union.right - union.x, height: union.bottom - union.y, ['--selection-scale' as string]: screenScale } as CSSProperties}>
      <span className="selection-label" style={{ transform: `translate(-50%, -100%) scale(${screenScale})` }}>{single ? primaryNode?.name : `${boxes.length} Layers`}</span>
      <span className="selection-dimensions" style={{ transform: `translate(-50%, 0) scale(${screenScale})` }}>{Math.round(union.right - union.x)} × {Math.round(union.bottom - union.y)}</span>
      {renderHandles && <>
        <button className="rotate-handle" type="button" aria-label={`Rotate ${primaryNode.name}`} onPointerDown={(event) => onRotate(primary.id, event)} />
        {handles.map((handle) => <button key={handle} className={`resize-handle handle-${handle}`} type="button" aria-label={`Resize ${primaryNode.name} ${handle}`} onPointerDown={(event) => onResize(primary.id, handle, event)} />)}
      </>}
    </div>
  </div>;
}

function ToolRail({ tool, onTool, shapeMenuOpen, onShapeMenu, onFit, leftOpen, canUndo, canRedo, onUndo, onRedo }: { tool: ToolName; onTool: (tool: ToolName) => void; shapeMenuOpen: boolean; onShapeMenu: () => void; onFit: () => void; leftOpen: boolean; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  const tools: Array<{ id: ToolName; icon: ReactNode }> = [
    { id: 'select', icon: <Scan size={18} /> },
    { id: 'pan', icon: <Hand size={18} /> },
    { id: 'add-frame', icon: <Frame size={18} /> },
  ];
  const shapes: Array<{ id: ShapeKind; icon: ReactNode }> = [
    { id: 'rectangle', icon: <Square size={17} /> },
    { id: 'ellipse', icon: <Circle size={17} /> },
    { id: 'line', icon: <MinusIcon /> },
    { id: 'arrow', icon: <ArrowRight size={17} /> },
    { id: 'polygon', icon: <Triangle size={17} /> },
  ];
  return <aside className={`tool-rail ${leftOpen ? '' : 'without-left-panel'}`} aria-label="Tools">
    {tools.map(({ id, icon }) => <button key={id} type="button" className={`tool-button ${tool === id ? 'is-active' : ''}`} aria-label={TOOL_LABELS[id]} title={TOOL_LABELS[id]} onClick={() => onTool(id)}>{icon}</button>)}
    <div className="shape-tool-anchor">
      <button type="button" className={`tool-button ${shapeMenuOpen || shapes.some((shape) => shape.id === tool) ? 'is-active' : ''}`} aria-label="Shapes" title="Shapes" aria-expanded={shapeMenuOpen} onClick={onShapeMenu}><Square size={18} /><ChevronRight className="shape-chevron" size={11} /></button>
      {shapeMenuOpen && <div className="shapes-menu" role="menu" aria-label="Shape tools">{shapes.map(({ id, icon }) => <button key={id} type="button" role="menuitem" className={tool === id ? 'is-selected' : ''} onClick={() => { onTool(id); onShapeMenu(); }}><span>{icon}</span><span>{TOOL_LABELS[id]}</span></button>)}</div>}
    </div>
    <button type="button" className={`tool-button ${tool === 'text' ? 'is-active' : ''}`} aria-label={TOOL_LABELS.text} title={TOOL_LABELS.text} onClick={() => onTool('text')}><Type size={18} /></button>
    <span className="tool-divider" />
    <span className="tool-rail-spacer" />
    <button type="button" className="tool-button" aria-label="Fit Canvas" title="Fit Canvas" onClick={onFit}><Scan size={17} /></button>
    <span className="tool-divider rail-history-divider" />
    <div className="rail-history" aria-label="History"><IconButton label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></IconButton><IconButton label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></IconButton></div>
  </aside>;
}

function MinusIcon() {
  return <span className="minus-icon" aria-hidden="true" />;
}

type LayerRevealRequest = { token: number; ids: string[] };
type LayerDropTarget = { id: string; before: boolean };

type LeftPanelProps = {
  width: number;
  resizeActive: boolean;
  resizeMin: number;
  resizeMax: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  files: EditorState['files'];
  activeFileId: string;
  onSwitchFile: (id: string) => void;
  onNewFile: () => void;
  onRenameFile: () => void;
  theme: ThemeMode;
  onTheme: (theme: ThemeMode) => void;
  document: DocumentModel;
  designs: DesignNode[];
  activeDesign?: DesignNode;
  assets: ImageAsset[];
  selectedAssetId: string | null;
  onSelectAsset: (id: string | null) => void;
  onUploadAssets: () => void;
  onPasteAsset?: () => void;
  selectedIds: string[];
  workingIds: string[];
  pulseIds: string[];
  revealRequest: LayerRevealRequest;
  onSelect: (id: string, additive?: boolean) => void;
  onSelectDesign: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onReorderLayer: (id: string, beforeId: string | null) => void;
  onCollapse: () => void;
};

function LeftPanel({ width, resizeActive, resizeMin, resizeMax, onResizeStart, onResizeKeyDown, files, activeFileId, onSwitchFile, onNewFile, onRenameFile, theme, onTheme, document, designs, activeDesign, assets, selectedAssetId, onSelectAsset, onUploadAssets, onPasteAsset, selectedIds, workingIds, pulseIds, revealRequest, onSelect, onSelectDesign, onToggleHidden, onToggleLocked, onReorderLayer, onCollapse }: LeftPanelProps) {
  const initialExpanded = designs.flatMap((design) => getDescendantIds(document, design.id)).filter((id) => document.nodes[id]?.type === 'frame');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(initialExpanded));
  const [panelTab, setPanelTab] = useState<'layers' | 'assets'>('layers');
  const [assetSearch, setAssetSearch] = useState('');
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LayerDropTarget | null>(null);
  const layerTreeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!revealRequest.ids.length) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      revealRequest.ids.forEach((id) => getAncestorIds(document, id).forEach((ancestorId) => next.add(ancestorId)));
      return next;
    });
  }, [document, revealRequest.ids, revealRequest.token]);

  useEffect(() => {
    if (!revealRequest.ids.length) return;
    const frame = window.requestAnimationFrame(() => {
      const container = layerTreeRef.current;
      if (!container) return;
      const rows = [...Array.from(container.querySelectorAll<HTMLElement>('[data-layer-row-id]')), ...Array.from(container.querySelectorAll<HTMLElement>('[data-frame-id]'))];
      const target = rows.find((row) => revealRequest.ids.includes(row.dataset.layerRowId ?? row.dataset.frameId ?? ''));
      target?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedIds, revealRequest.ids, revealRequest.token, activeDesign?.id]);

  const handleDragStart = (id: string, event: ReactDragEvent<HTMLDivElement>) => {
    if (isEffectivelyLocked(document, id) || (event.target as HTMLElement).closest('button')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
    setDraggedLayerId(id);
  };

  const handleDragOver = (id: string, event: ReactDragEvent<HTMLDivElement>) => {
    const source = draggedLayerId ? document.nodes[draggedLayerId] : undefined;
    const target = document.nodes[id];
    if (!source || !target || source.id === target.id || source.parentId !== target.parentId || isEffectivelyLocked(document, source.id) || isEffectivelyLocked(document, target.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ id, before: event.clientY < bounds.top + bounds.height / 2 });
  };

  const handleDrop = (id: string, event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedLayerId ?? event.dataTransfer.getData('text/plain');
    if (sourceId && dropTarget?.id === id) onReorderLayer(sourceId, getBeforeIdForVisualDrop(document, sourceId, id, dropTarget.before));
    setDraggedLayerId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedLayerId(null);
    setDropTarget(null);
  };

  const designChildIds = activeDesign?.childIds ?? [];
  const looseRootIds = getPage(document)?.rootIds.filter((id) => document.nodes[id]?.type !== 'artboard') ?? [];
  const hasLayers = designChildIds.length > 0 || looseRootIds.length > 0;
  const visibleAssets = assets.filter((asset) => !assetSearch.trim() || asset.originalName.toLowerCase().includes(assetSearch.trim().toLowerCase()) || (asset.sourceLabel ?? '').toLowerCase().includes(assetSearch.trim().toLowerCase()));
  const selectedAsset = selectedAssetId ? assets.find((asset) => asset.id === selectedAssetId) : undefined;

  const handleFileChange = (event: ChangeEvent<{ value: string }>) => {
    const value = event.target.value;
    if (value === '__new_file__') onNewFile();
    else if (value === '__rename_file__') onRenameFile();
    else onSwitchFile(value);
  };

  return <aside className="left-panel" style={{ width, minWidth: width }}>
    <div className="panel-heading">
      <div className="sidebar-brand-row"><IconButton label="Hide Layers panel" onClick={onCollapse}><PanelLeftClose size={17} /></IconButton><button className="brand-mark" type="button" title="Easel" aria-label="Easel"><span className="brand-glyph" />Easel</button></div>
      <label className="file-selector-field"><span className="panel-overline">Current File</span><select className="file-selector" aria-label="Current File" value={activeFileId} onChange={handleFileChange}>{files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}<option value="__new_file__">New File</option><option value="__rename_file__">Rename current File</option></select></label>
    </div>
    <div className="panel-tabs" role="tablist" aria-label="Panel views"><button type="button" role="tab" aria-selected={panelTab === 'layers'} className={panelTab === 'layers' ? 'is-active' : ''} onClick={() => setPanelTab('layers')}><Layers3 size={14} />Layers</button><button type="button" role="tab" aria-selected={panelTab === 'assets'} className={panelTab === 'assets' ? 'is-active' : ''} onClick={() => setPanelTab('assets')}><ImageIcon size={14} />Assets<span className="tab-count">{assets.length}</span></button></div>
    {panelTab === 'layers' ? <>
      <section className="panel-section frames-section">
        <div className="section-heading"><span>Frames</span><span className="layer-count">{designs.length}</span></div>
        <div className="design-list">{designs.map((design) => <div key={design.id} className={`design-row frame-row ${activeDesign?.id === design.id ? 'is-active' : ''} ${selectedIds.includes(design.id) ? 'is-selected' : ''} ${workingIds.includes(design.id) ? 'is-agent-working' : ''} ${pulseIds.includes(design.id) ? 'is-agent-changed' : ''}`} data-frame-id={design.id}>
          <button type="button" className="design-main" onClick={() => onSelectDesign(design.id)}><span className="design-icon">{nodeIcon(design.type)}</span><span className="design-copy"><span className="design-name" title={design.name}>{design.name}</span><small>{Math.round(design.width)} × {Math.round(design.height)}</small></span></button>
          <div className="row-actions"><button type="button" className="tiny-action" aria-label={`${design.hidden ? 'Show' : 'Hide'} ${design.name}`} title={design.hidden ? 'Show' : 'Hide'} onClick={() => onToggleHidden(design.id)}>{design.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button><button type="button" className={`tiny-action layer-lock ${design.locked ? 'is-locked' : ''}`} aria-label={`${design.locked ? 'Unlock' : 'Lock'} ${design.name}`} title={design.locked ? 'Unlock' : 'Lock'} onClick={() => onToggleLocked(design.id)}>{design.locked ? <Lock size={14} /> : <Unlock size={14} />}</button></div>
        </div>)}</div>
      </section>
      <section className="panel-section layers-section">
        <div className="section-heading"><span>{activeDesign ? `Layers · ${activeDesign.name}` : 'Layers'}</span><button className="small-action collapse-layers-action" type="button" aria-label="Collapse all layers" title="Collapse all layers" onClick={() => setExpandedIds(new Set())}><ChevronDown size={14} /></button></div>
        <div className="layer-tree" ref={layerTreeRef}>
          {activeDesign && designChildIds.slice().reverse().map((id) => <LayerTree key={id} id={id} document={document} selectedIds={selectedIds} workingIds={workingIds} pulseIds={pulseIds} depth={0} expandedIds={expandedIds} dropTarget={dropTarget} onSelect={onSelect} onToggleExpanded={(id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={handleDragEnd} />)}
          {looseRootIds.length > 0 && <div className="canvas-items-group"><div className="layer-group-label">Canvas items</div>{looseRootIds.slice().reverse().map((id) => <LayerTree key={id} id={id} document={document} selectedIds={selectedIds} workingIds={workingIds} pulseIds={pulseIds} depth={0} expandedIds={expandedIds} dropTarget={dropTarget} onSelect={onSelect} onToggleExpanded={(id) => setExpandedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={handleDragEnd} />)}</div>}
          {!hasLayers && <div className="layers-empty"><Layers3 size={17} /><span>Nothing in this Frame yet.</span></div>}
        </div>
      </section>
    </> : <section className="assets-panel" aria-label="Assets">
      <div className="asset-toolbar"><label className="asset-search"><span className="visually-hidden">Search Assets</span><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search assets" /></label><button type="button" className="asset-action" onClick={onUploadAssets}><Plus size={14} />Upload</button><button type="button" className="asset-action" onClick={onPasteAsset}><Clipboard size={14} />Paste</button></div>
      <div className="asset-grid">{visibleAssets.map((asset) => <button key={asset.id} type="button" className={`asset-card ${selectedAssetId === asset.id ? 'is-selected' : ''}`} draggable onClick={() => onSelectAsset(asset.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-easel-asset', asset.id); event.dataTransfer.setData('text/plain', asset.id); }} title="Select or drag into a Frame"><span className="asset-thumb"><img src={asset.dataUrl} alt="" draggable={false} /></span><span className="asset-name">{asset.originalName}</span><small>{asset.sourceLabel ?? 'Uploaded'}</small></button>)}{!visibleAssets.length && <div className="assets-empty"><ImageIcon size={18} /><span>{assets.length ? 'No Assets match this search.' : 'Upload or paste an image to build this library.'}</span></div>}</div>
      {selectedAsset && <div className="asset-preview"><img src={selectedAsset.dataUrl} alt={selectedAsset.originalName} /><div><strong>{selectedAsset.originalName}</strong><span>{selectedAsset.sourceLabel ?? 'Uploaded'} · {selectedAsset.naturalWidth} × {selectedAsset.naturalHeight}</span><small>Drag into a Frame to place</small></div></div>}
    </section>}
    <div className="panel-footer"><button className="theme-toggle" type="button" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><span className={`theme-dot ${theme === 'dark' ? 'dark-dot' : 'light-dot'}`} /><span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button><span className="revision-label">r{document.revision}</span></div>
    <div className={`panel-resize-handle ${resizeActive ? 'is-active' : ''}`} role="separator" aria-label="Resize canvas panel" aria-orientation="vertical" aria-valuemin={resizeMin} aria-valuemax={resizeMax} aria-valuenow={width} aria-valuetext={`${width} pixels`} tabIndex={0} onPointerDown={onResizeStart} onKeyDown={onResizeKeyDown} title="Resize canvas panel" />
  </aside>;
}

type LayerTreeProps = {
  id: string;
  document: DocumentModel;
  selectedIds: string[];
  workingIds: string[];
  pulseIds: string[];
  depth: number;
  expandedIds: Set<string>;
  dropTarget: LayerDropTarget | null;
  onSelect: (id: string, additive?: boolean) => void;
  onToggleExpanded: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onDragStart: (id: string, event: ReactDragEvent<HTMLDivElement>) => void;
  onDragOver: (id: string, event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (id: string, event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
};

function LayerTree({ id, document, selectedIds, workingIds, pulseIds, depth, expandedIds, dropTarget, onSelect, onToggleExpanded, onToggleHidden, onToggleLocked, onDragStart, onDragOver, onDrop, onDragEnd }: LayerTreeProps) {
  const node = document.nodes[id];
  if (!node) return null;
  const open = expandedIds.has(node.id);
  const effectivelyLocked = isEffectivelyLocked(document, node.id);
  const rowClasses = ['layer-row', selectedIds.includes(node.id) ? 'is-selected' : '', workingIds.includes(node.id) ? 'is-agent-working' : '', pulseIds.includes(node.id) ? 'is-agent-changed' : '', dropTarget?.id === node.id && dropTarget.before ? 'is-drop-before' : '', dropTarget?.id === node.id && !dropTarget.before ? 'is-drop-after' : ''].filter(Boolean).join(' ');
  return <div className="layer-tree-node"><div className={rowClasses} style={{ paddingLeft: 10 + depth * 14 }} data-layer-row-id={node.id} draggable={!effectivelyLocked} onDragStart={(event) => onDragStart(node.id, event)} onDragOver={(event) => onDragOver(node.id, event)} onDrop={(event) => onDrop(node.id, event)} onDragEnd={onDragEnd}>
    {node.childIds.length ? <button type="button" className="disclosure-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} onClick={() => onToggleExpanded(node.id)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="disclosure-spacer" />}
    <button className="layer-main" type="button" onClick={(event) => onSelect(node.id, event.shiftKey)}><span className="layer-icon">{nodeIcon(node.type)}</span><span className="layer-name" title={node.name}>{node.name}</span></button>
    <button type="button" className="layer-visibility" aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.name}`} title={node.hidden ? 'Show' : 'Hide'} onClick={() => onToggleHidden(node.id)}>{node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    <button type="button" className={`layer-lock ${node.locked ? 'is-locked' : ''}`} aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`} title={node.locked ? 'Unlock' : 'Lock'} onClick={() => onToggleLocked(node.id)}>{node.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
  </div>{open && node.childIds.slice().reverse().map((childId) => <LayerTree key={childId} id={childId} document={document} selectedIds={selectedIds} workingIds={workingIds} pulseIds={pulseIds} depth={depth + 1} expandedIds={expandedIds} dropTarget={dropTarget} onSelect={onSelect} onToggleExpanded={onToggleExpanded} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />)}</div>;
}

type InspectorProps = {
  node: DesignNode;
  selectedCount: number;
  document: DocumentModel;
  frameId?: string;
  exportOpen: boolean;
  exportArtboards: DesignNode[];
  exportIds: string[];
  exportFormat: ExportFormat;
  exportScale: 1 | 2;
  onClose: () => void;
  onPreview: () => void;
  onUpdate: (updates: ElementPatch[]) => void;
  onToggleLocked: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAlign: (alignment: 'left' | 'right' | 'top' | 'bottom' | 'horizontal-center' | 'vertical-center') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onReorder: (direction: 'forward' | 'backward' | 'front' | 'back') => void;
  onReapply: () => void;
  onUnbind: () => void;
  onExport: () => void;
  onExportFormat: (format: ExportFormat) => void;
  onExportScale: (scale: 1 | 2) => void;
  onToggleExportFrame: (id: string) => void;
  onCloseExport: () => void;
  onPrepareExport: () => void;
};

function Inspector({ node, selectedCount, document, frameId, exportOpen, exportArtboards, exportIds, exportFormat, exportScale, onExportFormat, onExportScale, onToggleExportFrame, onCloseExport, onPrepareExport, onClose, onPreview, onUpdate, onToggleLocked, onDelete, onDuplicate, onAlign, onDistribute, onGroup, onUngroup, onReorder, onReapply, onUnbind, onExport }: InspectorProps) {
  const [contentDraft, setContentDraft] = useState(node.content ?? '');
  useEffect(() => setContentDraft(node.content ?? ''), [node.id, node.content]);
  const commitField = (patch: ElementPatch) => {
    const textSizePatch = node.type === 'text' && patch.width !== undefined ? { height: measureTextBoxHeight(node, patch.width) } : node.type === 'text' && patch.content !== undefined ? { height: measureTextBoxHeight(node, node.width, patch.content) } : {};
    onUpdate([{ ...patch, ...textSizePatch }]);
  };
  const parent = node.parentId ? document.nodes[node.parentId] : undefined;
  const boundDiffers = Boolean(node.binding && (node.type === 'text' ? node.content !== node.binding.sharedValue : node.image?.assetId !== node.binding.sharedValue));
  return <aside className="right-panel inspector-drawer">
    <div className="inspector-heading"><div><span className="panel-overline">Inspector</span><h2>{selectedCount > 1 ? `${selectedCount} selected` : node.name}</h2></div><div className="inspector-heading-actions"><IconButton label={node.locked ? 'Unlock Layer' : 'Lock Layer'} onClick={onToggleLocked}>{node.locked ? <Lock size={16} /> : <Unlock size={16} />}</IconButton><IconButton label="Close Inspector" onClick={onClose}><X size={16} /></IconButton></div></div>
    <div className="inspector-scroll">
      {selectedCount > 1 ? <MultiInspectorActions onDuplicate={onDuplicate} onDelete={onDelete} onAlign={onAlign} onDistribute={onDistribute} onGroup={onGroup} onReorder={onReorder} /> : <>
        <InspectorSection title="Layout" icon={<Settings2 size={15} />}>
          <div className="field-grid four"><NumberField label="X" value={node.x} step={1} onCommit={(value) => commitField({ id: node.id, x: value })} /><NumberField label="Y" value={node.y} step={1} onCommit={(value) => commitField({ id: node.id, y: value })} /><NumberField label="W" value={node.width} step={1} min={1} onCommit={(value) => commitField({ id: node.id, width: value })} /><NumberField label="H" value={node.height} step={1} min={1} onCommit={(value) => commitField({ id: node.id, height: value })} /></div>
          <div className="field-row"><span className="field-label">Rotation</span><NumberField label="Rotation" hideLabel value={node.rotation} step={1} onCommit={(value) => commitField({ id: node.id, rotation: value })} /><span className="field-suffix">deg</span></div>
        </InspectorSection>
        <InspectorSection title="Fill" icon={<Palette size={15} />}>
          {node.type !== 'text' && <ColorField label="Fill" value={node.style.fill} onCommit={(value) => commitField({ id: node.id, style: { fill: value } })} />}
        </InspectorSection>
        <InspectorSection title="Border" icon={<Square size={15} />}>
          <ColorField label="Color" value={node.style.borderColor} onCommit={(value) => commitField({ id: node.id, style: { borderColor: value } })} />
          <div className="field-grid three"><NumberField label="Width" value={node.style.borderWidth} step={1} min={0} onCommit={(value) => commitField({ id: node.id, style: { borderWidth: value } })} /><NumberField label="Radius" value={node.style.borderRadius} step={1} min={0} onCommit={(value) => commitField({ id: node.id, style: { borderRadius: value } })} /><SelectField label="Style" value={node.style.borderStyle} options={['solid', 'dashed', 'dotted']} onCommit={(value) => commitField({ id: node.id, style: { borderStyle: value as 'solid' | 'dashed' | 'dotted' } })} /></div>
        </InspectorSection>
        <InspectorSection title="Effects" icon={<Settings2 size={15} />}>
          <div className="field-row"><span className="field-label">Opacity</span><input className="range-input" aria-label="Opacity" type="range" min="0" max="1" step="0.01" value={node.style.opacity} onChange={(event) => commitField({ id: node.id, style: { opacity: Number(event.target.value) } })} /><span className="range-value">{Math.round(node.style.opacity * 100)}%</span></div>
        </InspectorSection>
        {node.type === 'text' && <InspectorSection title="Typography" icon={<Type size={15} />}>
          <label className="stacked-field"><span className="field-label">Content</span><textarea className="content-editor" value={contentDraft} onChange={(event) => setContentDraft(event.target.value)} onBlur={() => { if (contentDraft !== (node.content ?? '')) commitField({ id: node.id, content: contentDraft }); }} rows={4} /></label>
          <label className="stacked-field"><span className="field-label">Font</span><select className="select-input" value={node.style.fontFamily} onChange={(event) => commitField({ id: node.id, style: { fontFamily: event.target.value } })}>{FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}</select></label>
          <div className="field-grid three"><NumberField label="Size" value={node.style.fontSize} step={1} min={1} onCommit={(value) => commitField({ id: node.id, style: { fontSize: value } })} /><SelectField label="Weight" value={String(node.style.fontWeight)} options={['400', '500', '600', '700']} onCommit={(value) => commitField({ id: node.id, style: { fontWeight: Number(value) as 400 | 500 | 600 | 700 } })} /><NumberField label="Leading" value={node.style.lineHeight} step={0.05} min={0.5} onCommit={(value) => commitField({ id: node.id, style: { lineHeight: value } })} /></div>
          <div className="field-grid two"><NumberField label="Tracking" value={node.style.letterSpacing} step={0.5} onCommit={(value) => commitField({ id: node.id, style: { letterSpacing: value } })} /><SelectField label="Align" value={node.style.textAlign} options={['left', 'center', 'right']} onCommit={(value) => commitField({ id: node.id, style: { textAlign: value as 'left' | 'center' | 'right' } })} /></div>
          <ColorField label="Text color" value={node.style.color} onCommit={(value) => commitField({ id: node.id, style: { color: value } })} />
        </InspectorSection>}
        {node.type === 'image' && <InspectorSection title="Asset" icon={<ImageIcon size={15} />}>
          <label className="stacked-field"><span className="field-label">Label</span><input className="text-input" value={node.image?.label ?? ''} onChange={(event) => commitField({ id: node.id, image: { label: event.target.value } })} /></label>
          <label className="stacked-field"><span className="field-label">Alt text</span><textarea className="content-editor" value={node.image?.alt ?? ''} onChange={(event) => commitField({ id: node.id, image: { alt: event.target.value } })} rows={3} /></label>
          <div className="image-meta-row"><span>{node.image?.role ?? 'reference'}</span><span>{node.image?.naturalWidth ?? 0} × {node.image?.naturalHeight ?? 0}</span></div>
          {node.image?.palette.length ? <div className="palette-row" aria-label="Dominant colors">{node.image.palette.map((color) => <span key={color} className="palette-swatch" style={{ background: color }} title={color} />)}</div> : null}
        </InspectorSection>}
        {(node.type === 'frame' || node.type === 'artboard') && <details className="inspector-details"><summary><span><Layers3 size={15} />Frame layout</span><ChevronRight size={15} /></summary><div className="details-content"><SelectField label="Mode" value={node.layout?.mode ?? 'free'} options={['free', 'flex-row', 'flex-column']} onCommit={(value) => commitField({ id: node.id, layout: { mode: value as LayoutMode } })} /><div className="field-grid two"><NumberField label="Gap" value={node.layout?.gap ?? 16} step={1} min={0} onCommit={(value) => commitField({ id: node.id, layout: { gap: value } })} /><NumberField label="Padding" value={node.layout?.padding ?? 24} step={1} min={0} onCommit={(value) => commitField({ id: node.id, layout: { padding: value } })} /></div><div className="field-grid two"><SelectField label="Align" value={node.layout?.alignItems ?? 'start'} options={['start', 'center', 'end', 'stretch']} onCommit={(value) => commitField({ id: node.id, layout: { alignItems: value as AlignItems } })} /><SelectField label="Justify" value={node.layout?.justifyContent ?? 'start'} options={['start', 'center', 'end', 'space-between']} onCommit={(value) => commitField({ id: node.id, layout: { justifyContent: value as 'start' | 'center' | 'end' | 'space-between' } })} /></div><label className="check-field"><input type="checkbox" checked={node.layout?.clipContent ?? false} onChange={(event) => commitField({ id: node.id, layout: { clipContent: event.target.checked } })} />Clip contents</label></div></details>}
        {node.type === 'polygon' && <InspectorSection title="Polygon" icon={<Triangle size={15} />}><NumberField label="Sides" value={node.shape?.sides ?? 6} step={1} min={3} onCommit={(value) => commitField({ id: node.id, shape: { sides: Math.round(value) } })} /></InspectorSection>}
        {node.binding && <details className="inspector-details binding-details" open><summary><span><Clipboard size={15} />Binding</span><ChevronRight size={15} /></summary><div className="details-content"><div className="binding-key">{node.binding.key}</div>{node.binding.sourceLabel && <div className="binding-source">Source label: {node.binding.sourceLabel}</div>}<div className="binding-source">Updated {new Date(node.binding.lastUpdatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>{boundDiffers && <div className="binding-diff">Differs from the shared value.</div>}<div className="binding-actions"><button type="button" className="secondary-button" onClick={onReapply} disabled={!node.binding.sharedValue}><Check size={14} />Reapply</button><button type="button" className="text-button" onClick={onUnbind}>Unbind</button></div></div></details>}
      </>}
      <div className="inspector-bottom-actions"><button type="button" className="secondary-button" onClick={onDuplicate}><Copy size={14} />Duplicate</button>{node.type === 'frame' && node.childIds.length > 0 && <button type="button" className="secondary-button" onClick={onUngroup}><Layers3 size={14} />Ungroup</button>}<button type="button" className="danger-button" onClick={onDelete}><Trash2 size={14} />Delete</button></div>
      {selectedCount === 1 && <div className="stacked-actions"><span className="field-label">Arrange</span><div className="arrange-row"><IconButton label="Send backward" onClick={() => onReorder('backward')}><ArrowDown size={15} /></IconButton><IconButton label="Bring forward" onClick={() => onReorder('forward')}><ArrowUp size={15} /></IconButton><IconButton label="Send to back" onClick={() => onReorder('back')}><SendToBack size={15} /></IconButton><IconButton label="Bring to front" onClick={() => onReorder('front')}><BringToFront size={15} /></IconButton></div></div>}
       {selectedCount === 1 && <InspectorSection title="Export" icon={<Download size={15} />}><div className="inspector-export-actions"><button type="button" className="secondary-button" onClick={onPreview} disabled={!frameId}>Preview selected Frame</button><button type="button" className="secondary-button" onClick={onExport} disabled={!frameId}>Export selected Frame</button></div>{exportOpen && <ExportPopover artboards={exportArtboards} selectedIds={exportIds} format={exportFormat} scale={exportScale} onFormat={onExportFormat} onScale={onExportScale} onToggle={onToggleExportFrame} onClose={onCloseExport} onExport={onPrepareExport} />}</InspectorSection>}
      {parent && <div className="parent-hint">Inside {parent.name}</div>}
    </div>
  </aside>;
}

function InspectorSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <details className="inspector-section" open><summary className="inspector-section-title">{icon}<span>{title}</span><ChevronRight size={13} /></summary><div className="inspector-section-content">{children}</div></details>;
}

function MultiInspectorActions({ onDuplicate, onDelete, onAlign, onDistribute, onGroup, onReorder }: { onDuplicate: () => void; onDelete: () => void; onAlign: InspectorProps['onAlign']; onDistribute: InspectorProps['onDistribute']; onGroup: () => void; onReorder: InspectorProps['onReorder'] }) {
  return <div className="multi-actions"><p>Multi-selection</p><div className="action-grid"><IconButton label="Align left" onClick={() => onAlign('left')}><AlignStartHorizontal size={16} /></IconButton><IconButton label="Align horizontal center" onClick={() => onAlign('horizontal-center')}><AlignCenterHorizontal size={16} /></IconButton><IconButton label="Align right" onClick={() => onAlign('right')}><AlignEndHorizontal size={16} /></IconButton><IconButton label="Align top" onClick={() => onAlign('top')}><AlignStartVertical size={16} /></IconButton><IconButton label="Align vertical center" onClick={() => onAlign('vertical-center')}><AlignCenterVertical size={16} /></IconButton><IconButton label="Align bottom" onClick={() => onAlign('bottom')}><AlignEndVertical size={16} /></IconButton><IconButton label="Distribute horizontally" onClick={() => onDistribute('horizontal')}><AlignHorizontalDistributeCenter size={16} /></IconButton><IconButton label="Group" onClick={onGroup}><Layers3 size={16} /></IconButton></div><div className="multi-action-buttons"><button type="button" className="secondary-button" onClick={onDuplicate}><Copy size={14} />Duplicate</button><button type="button" className="secondary-button" onClick={() => onReorder('front')}><BringToFront size={14} />Front</button><button type="button" className="danger-button" onClick={onDelete}><Trash2 size={14} />Delete</button></div></div>;
}

function NumberField({ label, value, onCommit, step = 1, min = -20000, hideLabel = false }: { label: string; value: number; onCommit: (value: number) => void; step?: number; min?: number; hideLabel?: boolean }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  const finish = () => { const parsed = Number(draft); if (Number.isFinite(parsed) && parsed >= min) onCommit(parsed); else setDraft(String(Number(value.toFixed(3)))); };
  return <label className={`number-field ${hideLabel ? 'hide-label' : ''}`}><span className="field-label">{label}</span><input aria-label={label} className="number-input" type="number" step={step} min={min} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

function SelectField({ label, value, options, onCommit }: { label: string; value: string; options: string[]; onCommit: (value: string) => void }) {
  return <label className="stacked-field"><span className="field-label">{label}</span><select className="select-input" aria-label={label} value={value} onChange={(event) => onCommit(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const finish = () => { if (/^(#[0-9a-f]{6}|transparent)$/i.test(draft)) onCommit(draft); else setDraft(value); };
  return <div className="color-field"><span className="field-label">{label}</span><span className="color-control"><input aria-label={`${label} color`} type="color" value={hexColor(value)} onChange={(event) => onCommit(event.target.value)} /><input className="color-text" aria-label={`${label} value`} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={finish} /></span></div>;
}

function FrameQuickCreate({ onCreate }: { onCreate: (input: CreateArtboardInput) => void }) {
  const presets: Array<{ id: ArtboardPreset; label: string; size: string }> = [
    { id: 'website', label: 'Website', size: '880 × 600' },
    { id: 'website-mobile', label: 'Mobile', size: '390 × 844' },
    { id: 'graphic', label: 'Graphic', size: '480 × 600' },
  ];
  return <div className="frame-quick-create"><span className="quick-create-label">New Frame</span>{presets.map((preset) => <button key={preset.id} type="button" onClick={() => onCreate({ name: preset.label, preset: preset.id })}><span>{preset.label}</span><small>{preset.size}</small></button>)}<button type="button" className="custom-artboard-button" onClick={() => { const name = window.prompt('Frame name', 'Untitled Frame'); if (!name) return; const width = Number(window.prompt('Width in pixels', '880')); const height = Number(window.prompt('Height in pixels', '600')); if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) onCreate({ name, width, height }); }}>Custom…</button></div>;
}

function ExportPopover({ artboards, selectedIds, format, scale, onFormat, onScale, onToggle, onClose, onExport }: { artboards: DesignNode[]; selectedIds: string[]; format: ExportFormat; scale: 1 | 2; onFormat: (format: ExportFormat) => void; onScale: (scale: 1 | 2) => void; onToggle: (id: string) => void; onClose: () => void; onExport: () => void }) {
  return <div className="export-popover"><div className="popover-heading"><div><span className="panel-overline">Prepare files</span><h3>Export Frames</h3></div><IconButton label="Close export" onClick={onClose}><X size={16} /></IconButton></div><div className="export-field"><span className="field-label">Format</span><div className="format-options">{(['png', 'svg', 'html', 'json'] as ExportFormat[]).map((candidate) => <button key={candidate} type="button" className={format === candidate ? 'is-selected' : ''} onClick={() => onFormat(candidate)}>{candidate === 'html' ? 'Static HTML/CSS' : candidate.toUpperCase()}</button>)}</div></div>{format === 'png' && <div className="export-field"><span className="field-label">Scale</span><div className="format-options compact">{([1, 2] as const).map((candidate) => <button key={candidate} type="button" className={scale === candidate ? 'is-selected' : ''} onClick={() => onScale(candidate)}>{candidate}×</button>)}</div></div>}<div className="export-field"><span className="field-label">Frames</span><div className="export-artboard-list">{artboards.length ? artboards.map((artboard) => <label key={artboard.id} className="export-artboard-option"><input type="checkbox" checked={selectedIds.includes(artboard.id)} onChange={() => onToggle(artboard.id)} /><span><strong>{artboard.name}</strong><small>{Math.round(artboard.width)} × {Math.round(artboard.height)}</small></span></label>) : <span className="muted-copy">No Frames on this Canvas.</span>}</div></div><div className="popover-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={onExport} disabled={!selectedIds.length}><Download size={14} />Prepare export</button></div></div>;
}

function Toast({ state }: { state: ToastState }) {
  const Icon = state.kind === 'error' ? X : state.kind === 'warning' ? Settings2 : Save;
  return <div className={`toast toast-${state.kind}`} role={state.kind === 'error' ? 'alert' : 'status'}><Icon size={15} /><span>{state.message}</span></div>;
}

function PreviewOverlay({ preview, onClose, onDownload }: { preview: PreviewState; onClose: () => void; onDownload: () => void }) {
  return <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Frame preview"><div className="preview-dialog"><div className="preview-toolbar"><div><span className="panel-overline">Inspection preview</span><h2>{preview.title}</h2></div><div className="preview-toolbar-actions"><span className="preview-size">{preview.width} × {preview.height} · {preview.scale}× PNG</span><button type="button" className="secondary-button" onClick={onDownload}><Download size={14} />Download PNG</button><IconButton label="Close preview" onClick={onClose}><X size={17} /></IconButton></div></div><div className="preview-image-wrap"><img src={preview.imageUrl} alt={`${preview.title} preview`} /></div></div></div>;
}
