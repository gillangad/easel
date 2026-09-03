import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
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
  ArrowUp,
  BringToFront,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileText,
  FolderOpen,
  Frame,
  Hand,
  Image as ImageIcon,
  Keyboard,
  Layers3,
  Lock,
  Maximize2,
  MoreHorizontal,
  PanelLeft,
  Palette,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Scan,
  SendToBack,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  dispatchCommand,
  type Command,
  type CreateArtboardInput,
  tryDispatchCommand,
} from './commands';
import {
  clamp,
  createId,
  deepClone,
  createInitialState,
  getAbsolutePosition,
  getAbsoluteRect,
  getArtboards,
  getBoundingRect,
  getPage,
  getPageNodeIds,
  nowIso,
} from './model';
import { downloadBlob, prepareArtboardExport, snapshotId } from './exports';
import { deserializeDocument, loadEditorState, saveEditorState } from './persistence';
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
  Page,
  Point,
  PreviewState,
  ThemeMode,
  Viewport,
} from './types';

type ToolName = 'select' | 'pan' | 'artboard' | 'rectangle' | 'text' | 'image';
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
  artboard: 'Artboard',
  rectangle: 'Rectangle',
  text: 'Text',
  image: 'Image',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function hexColor(value: string, fallback = '#deded9'): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

function pointInRect(point: Point, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;
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

function readImageAsset(file: File): Promise<ImageAsset> {
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
  return type === 'artboard' ? 'artboard' : type;
}

export default function App() {
  const [state, setState] = useState<EditorState>(() => ({ ...createInitialState(), focus: null, preview: null }));
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<ToolName>('select');
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportScale, setExportScale] = useState<1 | 2>(1);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pulseIds, setPulseIds] = useState<string[]>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [documentNameDraft, setDocumentNameDraft] = useState('Untitled design');
  const [dragging, setDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<Record<string, PreviewTransform>>({});
  const dragRef = useRef<DragSession | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const clipboardIdsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const initialFitRef = useRef(false);

  const commit = useCallback((next: EditorState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    setToast({ message, kind });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const markPulse = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setPulseIds(ids);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseIds([]), 650);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadEditorState().then((next) => {
      if (cancelled) return;
      stateRef.current = next;
      setState(next);
      setDocumentNameDraft(next.document.name);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => { void saveEditorState(stateRef.current); }, 220);
    return () => window.clearTimeout(timer);
  }, [loaded, state.document.revision, state.document.updatedAt, state.theme, state.panels]);

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
  const selectedNodes = useMemo(() => currentDocument.selection.ids.map((id) => currentDocument.nodes[id]).filter((node): node is DesignNode => Boolean(node)), [currentDocument]);
  const primaryNode = currentDocument.selection.primaryId ? currentDocument.nodes[currentDocument.selection.primaryId] : undefined;

  const stageSize = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? Math.max(700, window.innerWidth - 560), height: rect?.height ?? Math.max(420, window.innerHeight - 140) };
  }, []);

  useEffect(() => {
    if (!loaded || initialFitRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      initialFitRef.current = true;
      const current = stateRef.current;
      const target = current.document.selection.ids.find((id) => current.document.nodes[id]?.type === 'artboard') ?? getArtboards(current.document)[0]?.id;
      if (!target) return;
      const size = stageSize();
      const viewport = computeFitViewport(current.document, [target], size.width, size.height, 1.08);
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
      panels: { leftOpen: false, rightOpen: false },
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
    commit({ ...current, panels: { leftOpen: false, rightOpen: false }, focus: { targetIds: [], previousPageId: current.document.activePageId, previousViewport: deepClone(current.document.viewport), previousPanels: deepClone(current.panels), startedAt: Date.now() } });
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

  const captureForTool = useCallback(async (artboardId: string, scale: 1 | 2, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('The tool call was cancelled.');
    const prepared = await prepareArtboardExport(stateRef.current.document, artboardId, 'png', scale);
    if (signal?.aborted) throw new Error('The tool call was cancelled.');
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(prepared.blob);
    previewUrlRef.current = url;
    const current = stateRef.current;
    const preview: PreviewState = { kind: 'artboard', title: current.document.nodes[artboardId]?.name ?? 'Artboard preview', imageUrl: url, artboardId, width: prepared.width, height: prepared.height, scale, snapshotId: snapshotId() };
    commit({ ...current, preview });
    notify('Artboard preview opened for inspection.', 'success');
    return { ok: true, message: 'PNG preview is open.', snapshotId: preview.snapshotId, artboardId, dimensions: { width: prepared.width, height: prepared.height }, scale, previewOpen: true, unsupportedStyles: prepared.unsupported };
  }, [commit, notify]);

  const exportForTool = useCallback(async (artboardIds: string[], format: ExportFormat, scale: 1 | 2, signal?: AbortSignal) => {
    const current = stateRef.current;
    const nodes = artboardIds.map((id) => current.document.nodes[id]);
    if (nodes.some((node) => !node || node.type !== 'artboard')) throw new Error('Every export ID must reference an existing artboard.');
    const preparedItems = [] as Array<{ fileName: string; bytes: number; artboardId?: string; width?: number; height?: number; unsupported: string[] }>;
    const ids = format === 'json' ? [artboardIds[0]] : artboardIds;
    for (const id of ids) {
      if (signal?.aborted) throw new Error('The tool call was cancelled.');
      const prepared = await prepareArtboardExport(current.document, id, format, scale);
      downloadBlob(prepared.blob, prepared.fileName);
      preparedItems.push({ fileName: prepared.fileName, bytes: prepared.blob.size, artboardId: prepared.artboardId, width: prepared.width, height: prepared.height, unsupported: prepared.unsupported });
    }
    notify(`Prepared ${preparedItems.length} ${format.toUpperCase()} export${preparedItems.length === 1 ? '' : 's'}.`, 'success');
    return { ok: true, message: `Prepared ${preparedItems.length} export file${preparedItems.length === 1 ? '' : 's'}.`, format, scale, files: preparedItems, exportReady: true };
  }, [notify]);

  useEffect(() => {
    if (!loaded) return;
    let cleanup: (() => void) | undefined;
    void registerWebMCPTools({ getState: () => stateRef.current, commit, focus: focusForInspection, capture: captureForTool, export: exportForTool }).then((result) => { cleanup = result.cleanup; });
    return () => cleanup?.();
  }, [captureForTool, commit, exportForTool, focusForInspection, loaded]);

  const importImage = useCallback(async (file: File, position?: Point) => {
    try {
      const asset = await readImageAsset(file);
      const center = position ?? screenToWorld((stageRef.current?.getBoundingClientRect().left ?? 0) + (stageRef.current?.clientWidth ?? 800) / 2, (stageRef.current?.getBoundingClientRect().top ?? 0) + (stageRef.current?.clientHeight ?? 600) / 2);
      runCommand({ type: 'insert-image-asset', asset, position: center, source: 'human' }, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The image could not be added.', 'error');
    }
  }, [notify, runCommand, screenToWorld]);

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].filter((file) => file.type.startsWith('image/'));
    files.forEach((file, index) => {
      const dimensions = stageRef.current?.getBoundingClientRect();
      const center = dimensions ? screenToWorld(dimensions.left + dimensions.width / 2 + index * 42, dimensions.top + dimensions.height / 2 + index * 42) : undefined;
      void importImage(file, center);
    });
    event.target.value = '';
  }, [importImage, screenToWorld]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const items = [...(event.clipboardData?.items ?? [])];
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        void importImage(file);
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
      notify('Copy an element in this document before pasting.', 'warning');
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
        commit({ ...stateRef.current, panels: { leftOpen: true, rightOpen: true } });
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
  }, [closePreview, commit, copySelection, exitFocus, notify, pasteSelection, runCommand, toggleCanvasFocus]);

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
      if (drag.kind === 'move') {
        const next: Record<string, PreviewTransform> = {};
        drag.ids.forEach((id) => {
          const base = drag.base[id];
          if (base) next[id] = { ...base, x: base.x + delta.x, y: base.y + delta.y };
        });
        setDragPreview(next);
      } else if (drag.kind === 'resize') {
        const base = drag.base;
        let x = base.x;
        let y = base.y;
        let width = base.width;
        let height = base.height;
        if (drag.corner.includes('e')) width = Math.max(20, base.width + delta.x);
        if (drag.corner.includes('s')) height = Math.max(20, base.height + delta.y);
        if (drag.corner.includes('w')) { width = Math.max(20, base.width - delta.x); x = base.x + base.width - width; }
        if (drag.corner.includes('n')) { height = Math.max(20, base.height - delta.y); y = base.y + base.height - height; }
        setDragPreview({ [drag.nodeId]: { ...base, x, y, width, height } });
      } else if (drag.kind === 'rotate') {
        const point = screenToWorld(event.clientX, event.clientY);
        const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180 / Math.PI;
        const startAngle = Math.atan2(screenToWorld(drag.startX, drag.startY).y - drag.center.y, screenToWorld(drag.startX, drag.startY).x - drag.center.x) * 180 / Math.PI;
        setDragPreview({ [drag.nodeId]: { ...drag.base, rotation: drag.base.rotation + angle - startAngle } });
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragging(false);
      const preview = dragPreview;
      if (drag.kind === 'move') {
        const updates: ElementPatch[] = drag.ids.flatMap((id) => preview[id] ? [{ id, x: preview[id].x, y: preview[id].y }] : []);
        if (updates.length) runCommand({ type: 'update-elements', updates, source: 'human' }, 'success');
      } else if (drag.kind === 'resize' && preview[drag.nodeId]) {
        const target = preview[drag.nodeId];
        runCommand({ type: 'update-elements', updates: [{ id: drag.nodeId, x: target.x, y: target.y, width: target.width, height: target.height }], source: 'human' }, 'success');
      } else if (drag.kind === 'rotate' && preview[drag.nodeId]) {
        runCommand({ type: 'update-elements', updates: [{ id: drag.nodeId, rotation: preview[drag.nodeId].rotation }], source: 'human' }, 'success');
      }
      setDragPreview({});
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [commit, dragPreview, runCommand, screenToWorld]);

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
    if (!selected.length) return;
    const base: Record<string, PreviewTransform> = {};
    selected.forEach((id) => {
      const node = current.document.nodes[id];
      if (node) base[id] = { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
    });
    dragRef.current = { kind: 'move', startX: event.clientX, startY: event.clientY, ids: selected, base };
    setDragging(true);
  }, [commit, tool]);

  const startPan = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || tool !== 'pan') return;
    event.preventDefault();
    dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, startPan: deepClone(stateRef.current.document.viewport.pan) };
    setDragging(true);
  }, [tool]);

  const startResize = useCallback((nodeId: string, corner: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = stateRef.current.document.nodes[nodeId];
    if (!node) return;
    dragRef.current = { kind: 'resize', startX: event.clientX, startY: event.clientY, nodeId, corner, base: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation } };
    setDragging(true);
  }, []);

  const startRotate = useCallback((nodeId: string, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const node = stateRef.current.document.nodes[nodeId];
    if (!node) return;
    const rect = getAbsoluteRect(stateRef.current.document, nodeId);
    dragRef.current = { kind: 'rotate', startX: event.clientX, startY: event.clientY, nodeId, base: { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation }, center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
    setDragging(true);
  }, []);

  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('.stage-hud, .artboard-quick-create')) return;
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
    if (tool === 'artboard') {
      const preset: ArtboardPreset = 'website-desktop';
      const size = { width: 1440, height: 900 };
      const input: CreateArtboardInput = { name: 'Website desktop', preset, position: { x: world.x - size.width / 2, y: world.y - size.height / 2 } };
      runCommand({ type: 'create-artboard', ...input, source: 'human' }, 'success');
      setTool('select');
      return;
    }
    if (tool === 'rectangle' || tool === 'text') {
      const artboard = getArtboards(current.document).find((candidate) => pointInRect(world, getAbsoluteRect(current.document, candidate.id)));
      const x = artboard ? world.x - artboard.x : world.x;
      const y = artboard ? world.y - artboard.y : world.y;
      const spec: ElementSpec = tool === 'text'
        ? { type: 'text', name: 'Text', content: 'Type something', x, y, width: 280, height: 52, style: { fontSize: 28, fontWeight: 500 } }
        : { type: 'rectangle', name: 'Rectangle', x, y, width: 180, height: 120, style: { fill: '#deded9', borderRadius: 12 } };
      runCommand({ type: 'insert-elements', ...(artboard ? { artboardId: artboard.id } : { pageId: current.document.activePageId }), elements: [spec], source: 'human' }, 'success');
      setTool('select');
      return;
    }
    if (tool === 'image') fileInputRef.current?.click();
  }, [runCommand, screenToWorld, startPan, tool]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const current = stateRef.current.document.viewport;
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAt(current.zoom * factor, event.clientX, event.clientY);
  }, [zoomAt]);

  const selectNode = useCallback((id: string, additive = false) => {
    runCommand({ type: 'set-selection', ids: [id], additive });
  }, [runCommand]);

  const commitText = useCallback((id: string, content: string) => {
    setEditingNodeId(null);
    runCommand({ type: 'update-elements', updates: [{ id, content }], source: 'human' }, 'success');
  }, [runCommand]);

  const renameDocument = useCallback(() => {
    if (documentNameDraft.trim() && documentNameDraft.trim() !== stateRef.current.document.name) runCommand({ type: 'set-document-name', name: documentNameDraft, source: 'human' }, 'success');
  }, [documentNameDraft, runCommand]);

  const resetDocument = useCallback((kind: 'new' | 'reset') => {
    const label = kind === 'new' ? 'Start a new blank document?' : 'Reset the document to its starting example?';
    if (!window.confirm(label)) return;
    const fresh = createInitialState();
    if (kind === 'new') {
      fresh.document.pages[0].rootIds = [];
      fresh.document.nodes = {};
      fresh.document.assets = {};
      fresh.document.selection = { ids: [], primaryId: null };
    }
    commit(fresh);
    setDocumentNameDraft(fresh.document.name);
    notify(kind === 'new' ? 'New document created.' : 'Document reset.', 'success');
    setMenuOpen(false);
  }, [commit, notify]);

  const importJson = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((raw) => {
      try {
        if (!window.confirm('Replace the current document with this JSON file?')) return;
        const document = deserializeDocument(raw);
        const next = { ...createInitialState(), ...stateRef.current, document, history: [], future: [], focus: null, preview: null, lastAction: null };
        commit(next);
        setDocumentNameDraft(document.name);
        notify('Document imported.', 'success');
      } catch (error) {
        notify(error instanceof Error ? error.message : 'The JSON file could not be imported.', 'error');
      }
    });
    setMenuOpen(false);
  }, [commit, notify]);

  if (!loaded) return <div className="loading-shell" aria-label="Loading Easel"><span className="loading-mark" /><span>Easel</span></div>;

  return (
    <div className={`app-shell theme-${state.theme}`} data-theme={state.theme}>
      <header className="topbar">
        <div className="topbar-left">
          <button className="brand-mark" type="button" title="Easel" aria-label="Easel"><span className="brand-glyph" />Easel</button>
          <span className="topbar-divider" />
          <input className="document-title" aria-label="Document name" value={documentNameDraft} onChange={(event) => setDocumentNameDraft(event.target.value)} onBlur={renameDocument} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} />
        </div>
        <div className="topbar-right">
          <div className="history-actions" aria-label="History">
            <IconButton label="Undo" disabled={!state.history.length} onClick={() => runCommand({ type: 'undo' })}><Undo2 size={16} /></IconButton>
            <IconButton label="Redo" disabled={!state.future.length} onClick={() => runCommand({ type: 'redo' })}><Redo2 size={16} /></IconButton>
          </div>
          <button className="export-top-button" type="button" onClick={() => { setExportIds([activeArtboards[0]?.id].filter((id): id is string => Boolean(id))); setExportOpen((open) => !open); setMenuOpen(false); }}><Download size={15} />Export</button>
          <div className="menu-anchor">
            <IconButton label="More" active={menuOpen} onClick={() => { setMenuOpen((open) => !open); setExportOpen(false); }}><MoreHorizontal size={18} /></IconButton>
            {menuOpen && <MoreMenu theme={state.theme} onClose={() => setMenuOpen(false)} onPreview={() => { setMenuOpen(false); if (activeArtboards[0]) void captureForTool(activeArtboards[0].id, 1); }} onTheme={(theme) => { commit({ ...stateRef.current, theme }); setMenuOpen(false); }} onNew={() => resetDocument('new')} onReset={() => resetDocument('reset')} onImport={() => importInputRef.current?.click()} />}
          </div>
        </div>
        {exportOpen && <ExportPopover artboards={activeArtboards} selectedIds={exportIds} format={exportFormat} scale={exportScale} onFormat={setExportFormat} onScale={setExportScale} onToggle={(id) => setExportIds((ids) => ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id])} onClose={() => setExportOpen(false)} onExport={() => { if (!exportIds.length) { notify('Choose at least one artboard.', 'warning'); return; } void exportForTool(exportIds, exportFormat, exportScale).then(() => setExportOpen(false)).catch((error) => notify(error instanceof Error ? error.message : 'Export failed.', 'error')); }} />}
      </header>

      <div className="workspace">
        {state.panels.leftOpen && <LeftPanel document={currentDocument} selectedIds={currentDocument.selection.ids} onSelect={selectNode} onCreatePage={() => runCommand({ type: 'create-page', source: 'human' }, 'success')} onRenamePage={(pageId, name) => runCommand({ type: 'rename-page', pageId, name, source: 'human' }, 'success')} onDeletePage={(pageId) => { if (window.confirm('Delete this page and its elements?')) runCommand({ type: 'delete-page', pageId, source: 'human' }, 'success'); }} onToggleHidden={(id) => runCommand({ type: 'toggle-hidden', ids: [id], source: 'human' })} onToggleLocked={(id) => runCommand({ type: 'toggle-locked', ids: [id], source: 'human' })} onSetPage={(pageId) => { commit({ ...stateRef.current, document: { ...stateRef.current.document, activePageId: pageId, selection: { ids: [], primaryId: null } } }); }} onCollapse={() => commit({ ...stateRef.current, panels: { ...stateRef.current.panels, leftOpen: false } })} />}
        <ToolRail tool={tool} onTool={setTool} onFocus={toggleCanvasFocus} leftOpen={state.panels.leftOpen} />
        <main className="canvas-main">
          <div className={`canvas-stage ${dragging ? 'is-dragging' : ''}`} ref={stageRef} onPointerDown={handleStagePointerDown} onWheel={handleWheel} tabIndex={0} aria-label="Design pasteboard">
            <div className="stage-hud">
              <button type="button" className="hud-button" onClick={() => zoomAt(state.document.viewport.zoom - 0.1)} title="Zoom out"><ZoomOut size={15} /></button>
              <button type="button" className="zoom-readout" onClick={() => zoomAt(1)} title="Set zoom to 100%">{formatZoom(state.document.viewport.zoom)}</button>
              <button type="button" className="hud-button" onClick={() => zoomAt(state.document.viewport.zoom + 0.1)} title="Zoom in"><ZoomIn size={15} /></button>
              <span className="hud-divider" />
              <button type="button" className="hud-button hud-text-button" onClick={() => fitSelection()} title="Zoom to selection or document"><Scan size={15} />Fit</button>
            </div>
            {tool === 'artboard' && <ArtboardQuickCreate onCreate={(input) => { const dimensions = stageRef.current?.getBoundingClientRect(); const center = dimensions ? screenToWorld(dimensions.left + dimensions.width / 2, dimensions.top + dimensions.height / 2) : { x: 600, y: 400 }; const position = { x: center.x - (input.width ?? 1440) / 2, y: center.y - (input.height ?? 900) / 2 }; runCommand({ type: 'create-artboard', ...input, position, source: 'human' }, 'success'); setTool('select'); }} />}
            <div className="world" style={{ transform: `translate(${state.document.viewport.pan.x}px, ${state.document.viewport.pan.y}px) scale(${state.document.viewport.zoom})` }}>
              {activePage?.rootIds.map((id) => <NodeRenderer key={id} id={id} document={currentDocument} tool={tool} selectedIds={currentDocument.selection.ids} editingNodeId={editingNodeId} pulseIds={pulseIds} focusIds={state.focus?.targetIds ?? []} preview={dragPreview} onPointerDown={startMove} onDoubleClick={(id) => setEditingNodeId(id)} onCommitText={commitText} onSelect={selectNode} />)}
              <SelectionLayer document={currentDocument} selectedIds={currentDocument.selection.ids} preview={dragPreview} onResize={startResize} onRotate={startRotate} />
            </div>
            {state.focus && <div className="focus-hint"><Scan size={13} />Esc to exit focus</div>}
            <div className="stage-empty-hint" aria-hidden="true">{activePage?.rootIds.length ? '' : 'Choose a tool to start placing elements'}</div>
          </div>
        </main>
        {state.panels.rightOpen && primaryNode && <Inspector node={primaryNode} selectedCount={selectedNodes.length} document={currentDocument} onUpdate={(updates) => runCommand({ type: 'update-elements', updates, source: 'human' }, 'success')} onToggleHidden={() => runCommand({ type: 'toggle-hidden', ids: selectedNodes.map((node) => node.id), source: 'human' })} onToggleLocked={() => runCommand({ type: 'toggle-locked', ids: selectedNodes.map((node) => node.id), source: 'human' })} onDelete={() => runCommand({ type: 'delete-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onDuplicate={() => runCommand({ type: 'duplicate-elements', ids: selectedNodes.map((node) => node.id), source: 'human' }, 'success')} onAlign={(alignment) => runCommand({ type: 'align-elements', ids: selectedNodes.map((node) => node.id), alignment, source: 'human' })} onDistribute={(axis) => runCommand({ type: 'distribute-elements', ids: selectedNodes.map((node) => node.id), axis, source: 'human' })} onGroup={() => runCommand({ type: 'group-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onUngroup={() => runCommand({ type: 'ungroup-elements', ids: selectedNodes.map((node) => node.id), source: 'human' })} onReorder={(direction) => runCommand({ type: 'reorder-elements', ids: selectedNodes.map((node) => node.id), direction, source: 'human' })} onReapply={() => { if (!primaryNode.binding?.sharedValue) return; runCommand({ type: 'apply-context', values: [{ key: primaryNode.binding.key, value: primaryNode.type === 'image' ? { assetId: primaryNode.binding.sharedValue } : primaryNode.binding.sharedValue }], source: 'human' }, 'success'); }} onUnbind={() => runCommand({ type: 'unbind-context', ids: [primaryNode.id], source: 'human' })} />}
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={handleFileSelection} />
      <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importJson} />
      {toast && <Toast state={toast} />}
      {state.preview && <PreviewOverlay preview={state.preview} onClose={closePreview} onDownload={() => { const link = document.createElement('a'); link.href = state.preview?.imageUrl ?? ''; link.download = `${state.preview?.title ?? 'artboard'}-${state.preview?.scale ?? 1}x.png`; link.click(); }} />}
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
  focusIds: string[];
  preview: Record<string, PreviewTransform>;
  onPointerDown: (id: string, event: ReactPointerEvent) => void;
  onDoubleClick: (id: string) => void;
  onCommitText: (id: string, content: string) => void;
  onSelect: (id: string, additive?: boolean) => void;
};

function NodeRenderer({ id, document, tool, selectedIds, editingNodeId, pulseIds, focusIds, preview, onPointerDown, onDoubleClick, onCommitText }: NodeRendererProps) {
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
  const style: CSSProperties = {
    position: flexChild ? 'relative' : 'absolute',
    left: flexChild ? undefined : x,
    top: flexChild ? undefined : y,
    width,
    height,
    flex: flexChild ? `0 0 ${width}px` : undefined,
    background: node.type === 'text' ? 'transparent' : node.style.fill,
    border: `${node.style.borderWidth}px solid ${node.style.borderColor}`,
    borderRadius: node.style.borderRadius,
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
  const className = ['canvas-node', `node-${node.type}`, selectedIds.includes(node.id) ? 'is-selected' : '', pulseIds.includes(node.id) ? 'is-pulsing' : '', focusIds.includes(node.id) ? 'is-focus-target' : '', node.locked ? 'is-locked' : ''].filter(Boolean).join(' ');
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

  const children = node.childIds.map((childId) => <NodeRenderer key={childId} id={childId} document={document} tool={tool} selectedIds={selectedIds} editingNodeId={editingNodeId} pulseIds={pulseIds} focusIds={focusIds} preview={preview} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onCommitText={onCommitText} onSelect={() => undefined} />);
  if (node.type === 'text') {
    return <div ref={textRef} className={className} data-node-id={node.id} data-node-type={node.type} aria-label={node.name} style={{ ...style, whiteSpace: 'pre-wrap', outline: isEditing ? '2px solid var(--color-active)' : undefined, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }} contentEditable={isEditing && !node.locked} suppressContentEditableWarning onBlur={(event) => { if (isEditing) onCommitText(node.id, event.currentTarget.textContent ?? ''); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.blur(); } }}>{node.content ?? ''}{children}</div>;
  }
  if (node.type === 'image') {
    const asset = node.image?.assetId ? document.assets[node.image.assetId] : undefined;
    return <div className={className} data-node-id={node.id} data-node-type={node.type} aria-label={node.image?.alt || node.name} style={{ ...style, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }}><ImageContent asset={asset} alt={node.image?.alt || node.name} label={node.image?.label || node.name} />{children}</div>;
  }
  return <div className={`${className} ${node.type === 'artboard' ? 'artboard-node' : node.type === 'frame' ? 'frame-node' : 'rectangle-node'}`} data-node-id={node.id} data-node-type={node.type} data-label={node.name} aria-label={`${nodeTypeLabel(node.type)} ${node.name}`} style={{ ...style, cursor: node.locked ? 'not-allowed' : tool === 'select' ? 'move' : 'default' }} onPointerDown={onDown} onDoubleClick={(event) => { event.stopPropagation(); if (!node.locked) onDoubleClick(node.id); }}>{children}</div>;
}

function ImageContent({ asset, alt, label }: { asset?: ImageAsset; alt: string; label: string }) {
  if (!asset) return <div className="image-placeholder"><ImageIcon size={20} /><span>Image unavailable</span></div>;
  return <img className="node-image" src={asset.dataUrl} alt={alt} draggable={false} data-image-label={label} />;
}

type SelectionLayerProps = {
  document: DocumentModel;
  selectedIds: string[];
  preview: Record<string, PreviewTransform>;
  onResize: (id: string, corner: string, event: ReactPointerEvent) => void;
  onRotate: (id: string, event: ReactPointerEvent) => void;
};

function SelectionLayer({ document, selectedIds, preview, onResize, onRotate }: SelectionLayerProps) {
  return <div className="selection-layer" aria-hidden="true">{selectedIds.map((id) => {
    const node = document.nodes[id];
    if (!node) return null;
    const rect = getLocalPreviewRect(document, id, preview);
    const isPrimary = document.selection.primaryId === id && selectedIds.length === 1;
    return <div key={id} className={`selection-box ${isPrimary ? 'is-primary' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, transform: `rotate(${rect.rotation}deg)` }}>
      {isPrimary && !node.locked && <>
        <button className="rotate-handle" type="button" aria-label={`Rotate ${node.name}`} onPointerDown={(event) => onRotate(id, event)} />
        {['nw', 'ne', 'sw', 'se'].map((corner) => <button key={corner} className={`resize-handle handle-${corner}`} type="button" aria-label={`Resize ${node.name} ${corner}`} onPointerDown={(event) => onResize(id, corner, event)} />)}
      </>}
    </div>;
  })}</div>;
}

function ToolRail({ tool, onTool, onFocus, leftOpen }: { tool: ToolName; onTool: (tool: ToolName) => void; onFocus: () => void; leftOpen: boolean }) {
  const tools: Array<{ id: ToolName; icon: ReactNode }> = [
    { id: 'select', icon: <Scan size={18} /> },
    { id: 'pan', icon: <Hand size={18} /> },
    { id: 'artboard', icon: <Frame size={18} /> },
    { id: 'rectangle', icon: <Square size={18} /> },
    { id: 'text', icon: <Type size={18} /> },
    { id: 'image', icon: <ImageIcon size={18} /> },
  ];
  return <aside className={`tool-rail ${leftOpen ? '' : 'without-left-panel'}`} aria-label="Tools">
    {tools.map(({ id, icon }) => <button key={id} type="button" className={`tool-button ${tool === id ? 'is-active' : ''}`} aria-label={TOOL_LABELS[id]} title={TOOL_LABELS[id]} onClick={() => onTool(id)}>{icon}</button>)}
    <span className="tool-rail-spacer" />
    <button type="button" className="tool-button" aria-label="Focus canvas" title="Focus canvas shortcut" onClick={onFocus}><Maximize2 size={17} /></button>
  </aside>;
}

type LeftPanelProps = {
  document: DocumentModel;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onCreatePage: () => void;
  onRenamePage: (id: string, name: string) => void;
  onDeletePage: (id: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onSetPage: (id: string) => void;
  onCollapse: () => void;
};

function LeftPanel({ document, selectedIds, onSelect, onCreatePage, onRenamePage, onDeletePage, onToggleHidden, onToggleLocked, onSetPage, onCollapse }: LeftPanelProps) {
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [pageDraft, setPageDraft] = useState('');
  const beginRename = (page: Page) => { setRenamingPageId(page.id); setPageDraft(page.name); };
  const finishRename = () => { if (renamingPageId && pageDraft.trim()) onRenamePage(renamingPageId, pageDraft); setRenamingPageId(null); };
  return <aside className="left-panel">
    <div className="panel-heading"><div><span className="panel-overline">Document</span><h2>Pages & layers</h2></div><IconButton label="Collapse left panel" onClick={onCollapse}><PanelLeft size={17} /></IconButton></div>
    <section className="panel-section pages-section">
      <div className="section-heading"><span>Pages</span><button className="small-action" type="button" aria-label="Create page" title="Create page" onClick={onCreatePage}><Plus size={15} /></button></div>
      <div className="page-list">{document.pages.map((page) => <div key={page.id} className={`page-row ${page.id === document.activePageId ? 'is-active' : ''}`}>
        {renamingPageId === page.id ? <input className="inline-name-input" autoFocus value={pageDraft} onChange={(event) => setPageDraft(event.target.value)} onBlur={finishRename} onKeyDown={(event) => { if (event.key === 'Enter') finishRename(); if (event.key === 'Escape') setRenamingPageId(null); }} /> : <button type="button" className="page-name" onClick={() => onSetPage(page.id)} onDoubleClick={() => beginRename(page)}><FileText size={15} /><span>{page.name}</span></button>}
        <div className="row-actions"><button type="button" className="tiny-action" aria-label={`Rename ${page.name}`} title="Rename page" onClick={() => beginRename(page)}><MoreHorizontal size={15} /></button>{document.pages.length > 1 && <button type="button" className="tiny-action danger-action" aria-label={`Delete ${page.name}`} title="Delete page" onClick={() => onDeletePage(page.id)}><Trash2 size={14} /></button>}</div>
      </div>)}</div>
    </section>
    <section className="panel-section layers-section"><div className="section-heading"><span>Layers</span><span className="layer-count">{getPageNodeIds(document).length}</span></div><div className="layer-tree">{getPage(document)?.rootIds.slice().reverse().map((id) => <LayerTree key={id} id={id} document={document} selectedIds={selectedIds} depth={0} onSelect={onSelect} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} />)}</div>{!getPage(document)?.rootIds.length && <div className="layers-empty"><Layers3 size={17} /><span>Nothing on this page yet.</span></div>}</section>
    <div className="panel-footer"><span>Local document</span><span className="revision-label">r{document.revision}</span></div>
  </aside>;
}

function LayerTree({ id, document, selectedIds, depth, onSelect, onToggleHidden, onToggleLocked }: { id: string; document: DocumentModel; selectedIds: string[]; depth: number; onSelect: (id: string, additive?: boolean) => void; onToggleHidden: (id: string) => void; onToggleLocked: (id: string) => void }) {
  const node = document.nodes[id];
  const [open, setOpen] = useState(node?.type === 'artboard' || node?.type === 'frame');
  if (!node) return null;
  return <div className="layer-tree-node"><div className={`layer-row ${selectedIds.includes(node.id) ? 'is-selected' : ''}`} style={{ paddingLeft: 10 + depth * 14 }}>
    {node.childIds.length ? <button type="button" className="disclosure-button" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} onClick={() => setOpen((value) => !value)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="disclosure-spacer" />}
    <button className="layer-main" type="button" onClick={(event) => onSelect(node.id, event.shiftKey)}><span className="layer-icon">{nodeIcon(node.type)}</span><span className="layer-name" title={node.name}>{node.name}</span></button>
    <button type="button" className="layer-visibility" aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.name}`} title={node.hidden ? 'Show' : 'Hide'} onClick={() => onToggleHidden(node.id)}>{node.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    <button type="button" className={`layer-lock ${node.locked ? 'is-locked' : ''}`} aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.name}`} title={node.locked ? 'Unlock' : 'Lock'} onClick={() => onToggleLocked(node.id)}>{node.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
  </div>{open && node.childIds.slice().reverse().map((childId) => <LayerTree key={childId} id={childId} document={document} selectedIds={selectedIds} depth={depth + 1} onSelect={onSelect} onToggleHidden={onToggleHidden} onToggleLocked={onToggleLocked} />)}</div>;
}

type InspectorProps = {
  node: DesignNode;
  selectedCount: number;
  document: DocumentModel;
  onUpdate: (updates: ElementPatch[]) => void;
  onToggleHidden: () => void;
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
};

function Inspector({ node, selectedCount, document, onUpdate, onToggleHidden, onToggleLocked, onDelete, onDuplicate, onAlign, onDistribute, onGroup, onUngroup, onReorder, onReapply, onUnbind }: InspectorProps) {
  const [contentDraft, setContentDraft] = useState(node.content ?? '');
  useEffect(() => setContentDraft(node.content ?? ''), [node.id, node.content]);
  const commitField = (patch: ElementPatch) => onUpdate([patch]);
  const parent = node.parentId ? document.nodes[node.parentId] : undefined;
  const boundDiffers = Boolean(node.binding && (node.type === 'text' ? node.content !== node.binding.sharedValue : node.image?.assetId !== node.binding.sharedValue));
  return <aside className="right-panel">
    <div className="inspector-heading"><div><span className="panel-overline">Inspector</span><h2>{selectedCount > 1 ? `${selectedCount} selected` : node.name}</h2></div><div className="inspector-heading-actions"><IconButton label={node.hidden ? 'Show element' : 'Hide element'} onClick={onToggleHidden}>{node.hidden ? <EyeOff size={16} /> : <Eye size={16} />}</IconButton><IconButton label={node.locked ? 'Unlock element' : 'Lock element'} onClick={onToggleLocked}>{node.locked ? <Lock size={16} /> : <Unlock size={16} />}</IconButton></div></div>
    <div className="inspector-scroll">
      {selectedCount > 1 ? <MultiInspectorActions onDuplicate={onDuplicate} onDelete={onDelete} onAlign={onAlign} onDistribute={onDistribute} onGroup={onGroup} onReorder={onReorder} /> : <>
        <InspectorSection title="Transform" icon={<Settings2 size={15} />}>
          <div className="field-grid four"><NumberField label="X" value={node.x} step={1} onCommit={(value) => commitField({ id: node.id, x: value })} /><NumberField label="Y" value={node.y} step={1} onCommit={(value) => commitField({ id: node.id, y: value })} /><NumberField label="W" value={node.width} step={1} min={1} onCommit={(value) => commitField({ id: node.id, width: value })} /><NumberField label="H" value={node.height} step={1} min={1} onCommit={(value) => commitField({ id: node.id, height: value })} /></div>
          <div className="field-row"><span className="field-label">Rotation</span><NumberField label="Rotation" hideLabel value={node.rotation} step={1} onCommit={(value) => commitField({ id: node.id, rotation: value })} /><span className="field-suffix">deg</span></div>
        </InspectorSection>
        <InspectorSection title="Appearance" icon={<Palette size={15} />}>
          {node.type !== 'text' && <ColorField label="Fill" value={node.style.fill} onCommit={(value) => commitField({ id: node.id, style: { fill: value } })} />}
          <ColorField label="Border" value={node.style.borderColor} onCommit={(value) => commitField({ id: node.id, style: { borderColor: value } })} />
          <div className="field-grid two"><NumberField label="Border" value={node.style.borderWidth} step={1} min={0} onCommit={(value) => commitField({ id: node.id, style: { borderWidth: value } })} /><NumberField label="Radius" value={node.style.borderRadius} step={1} min={0} onCommit={(value) => commitField({ id: node.id, style: { borderRadius: value } })} /></div>
          <div className="field-row"><span className="field-label">Opacity</span><input className="range-input" aria-label="Opacity" type="range" min="0" max="1" step="0.01" value={node.style.opacity} onChange={(event) => commitField({ id: node.id, style: { opacity: Number(event.target.value) } })} /><span className="range-value">{Math.round(node.style.opacity * 100)}%</span></div>
        </InspectorSection>
        {node.type === 'text' && <InspectorSection title="Typography" icon={<Type size={15} />}>
          <label className="stacked-field"><span className="field-label">Content</span><textarea className="content-editor" value={contentDraft} onChange={(event) => setContentDraft(event.target.value)} onBlur={() => { if (contentDraft !== (node.content ?? '')) commitField({ id: node.id, content: contentDraft }); }} rows={4} /></label>
          <label className="stacked-field"><span className="field-label">Font</span><select className="select-input" value={node.style.fontFamily} onChange={(event) => commitField({ id: node.id, style: { fontFamily: event.target.value } })}>{FONT_OPTIONS.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}</select></label>
          <div className="field-grid three"><NumberField label="Size" value={node.style.fontSize} step={1} min={1} onCommit={(value) => commitField({ id: node.id, style: { fontSize: value } })} /><SelectField label="Weight" value={String(node.style.fontWeight)} options={['400', '500', '600', '700']} onCommit={(value) => commitField({ id: node.id, style: { fontWeight: Number(value) as 400 | 500 | 600 | 700 } })} /><NumberField label="Leading" value={node.style.lineHeight} step={0.05} min={0.5} onCommit={(value) => commitField({ id: node.id, style: { lineHeight: value } })} /></div>
          <div className="field-grid two"><NumberField label="Tracking" value={node.style.letterSpacing} step={0.5} onCommit={(value) => commitField({ id: node.id, style: { letterSpacing: value } })} /><SelectField label="Align" value={node.style.textAlign} options={['left', 'center', 'right']} onCommit={(value) => commitField({ id: node.id, style: { textAlign: value as 'left' | 'center' | 'right' } })} /></div>
          <ColorField label="Text color" value={node.style.color} onCommit={(value) => commitField({ id: node.id, style: { color: value } })} />
        </InspectorSection>}
        {node.type === 'image' && <InspectorSection title="Image details" icon={<ImageIcon size={15} />}>
          <label className="stacked-field"><span className="field-label">Label</span><input className="text-input" value={node.image?.label ?? ''} onChange={(event) => commitField({ id: node.id, image: { label: event.target.value } })} /></label>
          <label className="stacked-field"><span className="field-label">Alt text</span><textarea className="content-editor" value={node.image?.alt ?? ''} onChange={(event) => commitField({ id: node.id, image: { alt: event.target.value } })} rows={3} /></label>
          <div className="image-meta-row"><span>{node.image?.role ?? 'reference'}</span><span>{node.image?.naturalWidth ?? 0} × {node.image?.naturalHeight ?? 0}</span></div>
          {node.image?.palette.length ? <div className="palette-row" aria-label="Dominant colors">{node.image.palette.map((color) => <span key={color} className="palette-swatch" style={{ background: color }} title={color} />)}</div> : null}
        </InspectorSection>}
        {(node.type === 'frame' || node.type === 'artboard') && <details className="inspector-details"><summary><span><Layers3 size={15} />Layout</span><ChevronRight size={15} /></summary><div className="details-content"><SelectField label="Mode" value={node.layout?.mode ?? 'free'} options={['free', 'flex-row', 'flex-column']} onCommit={(value) => commitField({ id: node.id, layout: { mode: value as LayoutMode } })} /><div className="field-grid two"><NumberField label="Gap" value={node.layout?.gap ?? 16} step={1} min={0} onCommit={(value) => commitField({ id: node.id, layout: { gap: value } })} /><NumberField label="Padding" value={node.layout?.padding ?? 24} step={1} min={0} onCommit={(value) => commitField({ id: node.id, layout: { padding: value } })} /></div><div className="field-grid two"><SelectField label="Align" value={node.layout?.alignItems ?? 'start'} options={['start', 'center', 'end', 'stretch']} onCommit={(value) => commitField({ id: node.id, layout: { alignItems: value as AlignItems } })} /><SelectField label="Justify" value={node.layout?.justifyContent ?? 'start'} options={['start', 'center', 'end', 'space-between']} onCommit={(value) => commitField({ id: node.id, layout: { justifyContent: value as 'start' | 'center' | 'end' | 'space-between' } })} /></div><label className="check-field"><input type="checkbox" checked={node.layout?.clipContent ?? false} onChange={(event) => commitField({ id: node.id, layout: { clipContent: event.target.checked } })} />Clip contents</label></div></details>}
        {node.binding && <details className="inspector-details binding-details" open><summary><span><Clipboard size={15} />Binding</span><ChevronRight size={15} /></summary><div className="details-content"><div className="binding-key">{node.binding.key}</div>{node.binding.sourceLabel && <div className="binding-source">Source label: {node.binding.sourceLabel}</div>}<div className="binding-source">Updated {new Date(node.binding.lastUpdatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>{boundDiffers && <div className="binding-diff">Differs from the shared value.</div>}<div className="binding-actions"><button type="button" className="secondary-button" onClick={onReapply} disabled={!node.binding.sharedValue}><Check size={14} />Reapply</button><button type="button" className="text-button" onClick={onUnbind}>Unbind</button></div></div></details>}
      </>}
      <div className="inspector-bottom-actions"><button type="button" className="secondary-button" onClick={onDuplicate}><Copy size={14} />Duplicate</button>{node.type === 'frame' && node.childIds.length > 0 && <button type="button" className="secondary-button" onClick={onUngroup}><Layers3 size={14} />Ungroup</button>}<button type="button" className="danger-button" onClick={onDelete}><Trash2 size={14} />Delete</button></div>
      {selectedCount === 1 && <div className="stacked-actions"><span className="field-label">Arrange</span><div className="arrange-row"><IconButton label="Send backward" onClick={() => onReorder('backward')}><ArrowDown size={15} /></IconButton><IconButton label="Bring forward" onClick={() => onReorder('forward')}><ArrowUp size={15} /></IconButton><IconButton label="Send to back" onClick={() => onReorder('back')}><SendToBack size={15} /></IconButton><IconButton label="Bring to front" onClick={() => onReorder('front')}><BringToFront size={15} /></IconButton></div></div>}
      {parent && <div className="parent-hint">Inside {parent.name}</div>}
    </div>
  </aside>;
}

function InspectorSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="inspector-section"><div className="inspector-section-title">{icon}<span>{title}</span></div><div className="inspector-section-content">{children}</div></section>;
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

function MoreMenu({ theme, onClose, onPreview, onTheme, onNew, onReset, onImport }: { theme: ThemeMode; onClose: () => void; onPreview: () => void; onTheme: (theme: ThemeMode) => void; onNew: () => void; onReset: () => void; onImport: () => void }) {
  return <div className="more-menu" role="menu" onMouseLeave={() => undefined}>
    <button type="button" role="menuitem" onClick={onPreview}><Eye size={15} />Preview current artboard</button>
    <button type="button" role="menuitem" onClick={onImport}><FolderOpen size={15} />Import JSON document</button>
    <div className="menu-separator" />
    <div className="menu-label">Theme</div>
    <div className="theme-options"><button type="button" className={theme === 'light' ? 'is-selected' : ''} onClick={() => onTheme('light')}><span className="theme-dot light-dot" />Light{theme === 'light' && <Check size={14} />}</button><button type="button" className={theme === 'dark' ? 'is-selected' : ''} onClick={() => onTheme('dark')}><span className="theme-dot dark-dot" />Dark{theme === 'dark' && <Check size={14} />}</button></div>
    <div className="menu-separator" />
    <button type="button" role="menuitem" onClick={onNew}><FilePlus2 size={15} />New document</button>
    <button type="button" role="menuitem" onClick={onReset}><RotateCw size={15} />Reset example</button>
    <div className="menu-separator" />
    <div className="shortcut-hint"><Keyboard size={14} /><span>Ctrl + \ focuses canvas<br />Esc restores panels</span></div>
    <button type="button" className="menu-dismiss" aria-label="Close menu" onClick={onClose}><X size={14} />Close</button>
  </div>;
}

function ArtboardQuickCreate({ onCreate }: { onCreate: (input: CreateArtboardInput) => void }) {
  const presets: Array<{ id: ArtboardPreset; label: string; size: string }> = [
    { id: 'website-desktop', label: 'Desktop', size: '1440 × 900' },
    { id: 'website-mobile', label: 'Mobile', size: '390 × 844' },
    { id: 'poster-portrait', label: 'Poster', size: '1080 × 1350' },
    { id: 'a4-portrait', label: 'A4', size: '794 × 1123' },
  ];
  return <div className="artboard-quick-create"><span className="quick-create-label">New artboard</span>{presets.map((preset) => <button key={preset.id} type="button" onClick={() => onCreate({ name: preset.label === 'Desktop' ? 'Website desktop' : preset.label === 'Mobile' ? 'Website mobile' : preset.label === 'Poster' ? 'Poster portrait' : 'A4 portrait', preset: preset.id })}><span>{preset.label}</span><small>{preset.size}</small></button>)}<button type="button" className="custom-artboard-button" onClick={() => { const name = window.prompt('Artboard name', 'Untitled artboard'); if (!name) return; const width = Number(window.prompt('Width in pixels', '1200')); const height = Number(window.prompt('Height in pixels', '800')); if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) onCreate({ name, width, height }); }}>Custom…</button></div>;
}

function ExportPopover({ artboards, selectedIds, format, scale, onFormat, onScale, onToggle, onClose, onExport }: { artboards: DesignNode[]; selectedIds: string[]; format: ExportFormat; scale: 1 | 2; onFormat: (format: ExportFormat) => void; onScale: (scale: 1 | 2) => void; onToggle: (id: string) => void; onClose: () => void; onExport: () => void }) {
  return <div className="export-popover"><div className="popover-heading"><div><span className="panel-overline">Prepare files</span><h3>Export artboards</h3></div><IconButton label="Close export" onClick={onClose}><X size={16} /></IconButton></div><div className="export-field"><span className="field-label">Format</span><div className="format-options">{(['png', 'svg', 'html', 'json'] as ExportFormat[]).map((candidate) => <button key={candidate} type="button" className={format === candidate ? 'is-selected' : ''} onClick={() => onFormat(candidate)}>{candidate === 'html' ? 'Static HTML/CSS' : candidate.toUpperCase()}</button>)}</div></div>{format === 'png' && <div className="export-field"><span className="field-label">Scale</span><div className="format-options compact">{([1, 2] as const).map((candidate) => <button key={candidate} type="button" className={scale === candidate ? 'is-selected' : ''} onClick={() => onScale(candidate)}>{candidate}×</button>)}</div></div>}<div className="export-field"><span className="field-label">Artboards</span><div className="export-artboard-list">{artboards.length ? artboards.map((artboard) => <label key={artboard.id} className="export-artboard-option"><input type="checkbox" checked={selectedIds.includes(artboard.id)} onChange={() => onToggle(artboard.id)} /><span><strong>{artboard.name}</strong><small>{Math.round(artboard.width)} × {Math.round(artboard.height)}</small></span></label>) : <span className="muted-copy">No artboards on this page.</span>}</div></div><div className="popover-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={onExport} disabled={!selectedIds.length}><Download size={14} />Prepare export</button></div></div>;
}

function Toast({ state }: { state: ToastState }) {
  const Icon = state.kind === 'error' ? X : state.kind === 'warning' ? Settings2 : Save;
  return <div className={`toast toast-${state.kind}`} role={state.kind === 'error' ? 'alert' : 'status'}><Icon size={15} /><span>{state.message}</span></div>;
}

function PreviewOverlay({ preview, onClose, onDownload }: { preview: PreviewState; onClose: () => void; onDownload: () => void }) {
  return <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Artboard preview"><div className="preview-dialog"><div className="preview-toolbar"><div><span className="panel-overline">Inspection preview</span><h2>{preview.title}</h2></div><div className="preview-toolbar-actions"><span className="preview-size">{preview.width} × {preview.height} · {preview.scale}× PNG</span><button type="button" className="secondary-button" onClick={onDownload}><Download size={14} />Download PNG</button><IconButton label="Close preview" onClick={onClose}><X size={17} /></IconButton></div></div><div className="preview-image-wrap"><img src={preview.imageUrl} alt={`${preview.title} preview`} /></div></div></div>;
}
