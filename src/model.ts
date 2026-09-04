import {
  ARTBOARD_PRESETS,
  type ArtboardPreset,
  type DesignNode,
  type DocumentModel,
  type EaselFile,
  type EditorState,
  type ImageAsset,
  type LayerAnnotation,
  type LayoutStyle,
  type NodeStyle,
  type NodeType,
  type Page,
  type PanelsState,
  type Point,
  type Size,
  type SemanticTarget,
  type SizingMode,
  type Viewport,
} from './types';

export const MAX_HISTORY = 100;

export function createId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export const DEFAULT_VIEWPORT: Viewport = {
  zoom: 0.58,
  pan: { x: 120, y: 86 },
};

export const LEFT_PANEL_DEFAULT_WIDTH = 244;
export const LEFT_PANEL_MIN_WIDTH = 200;
export const LEFT_PANEL_MAX_WIDTH = 420;

export const DEFAULT_PANELS: PanelsState = {
  leftOpen: true,
  rightOpen: true,
  leftWidth: LEFT_PANEL_DEFAULT_WIDTH,
};

export function getLeftPanelBounds(viewportWidth = Number.POSITIVE_INFINITY): { minimum: number; maximum: number } {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : Number.POSITIVE_INFINITY;
  const viewportMaximum = Number.isFinite(safeViewportWidth) ? Math.floor(safeViewportWidth * 0.4) : LEFT_PANEL_MAX_WIDTH;
  const maximum = Math.min(LEFT_PANEL_MAX_WIDTH, viewportMaximum);
  return { minimum: Math.min(LEFT_PANEL_MIN_WIDTH, maximum), maximum };
}

export function clampLeftPanelWidth(value: number, viewportWidth = Number.POSITIVE_INFINITY): number {
  const bounds = getLeftPanelBounds(viewportWidth);
  const candidate = Number.isFinite(value) ? Math.round(value) : LEFT_PANEL_DEFAULT_WIDTH;
  return Math.min(bounds.maximum, Math.max(bounds.minimum, candidate));
}

export function normalizePanels(value: unknown): PanelsState {
  const candidate = typeof value === 'object' && value !== null ? value as Partial<PanelsState> : undefined;
  return {
    leftOpen: candidate?.leftOpen !== false,
    rightOpen: candidate?.rightOpen !== false,
    leftWidth: clampLeftPanelWidth(typeof candidate?.leftWidth === 'number' ? candidate.leftWidth : LEFT_PANEL_DEFAULT_WIDTH),
  };
}

export function defaultNodeStyle(type: NodeType): NodeStyle {
  if (type === 'text') {
    return {
      fill: 'transparent',
      opacity: 1,
      borderColor: 'transparent',
      borderWidth: 0,
      borderStyle: 'solid',
      borderRadius: 0,
      color: '#171717',
      fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 24,
      fontWeight: 500,
      lineHeight: 1.2,
      letterSpacing: 0,
      textAlign: 'left',
    };
  }
  if (type === 'artboard') {
    return {
      fill: '#ffffff',
      opacity: 1,
      borderColor: '#d9d9d5',
      borderWidth: 1,
      borderStyle: 'solid',
      borderRadius: 0,
      color: '#171717',
      fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: 'left',
    };
  }
  if (type === 'frame') {
    return {
      fill: 'transparent',
      opacity: 1,
      borderColor: 'transparent',
      borderWidth: 0,
      borderStyle: 'solid',
      borderRadius: 0,
      color: '#171717',
      fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: 'left',
    };
  }
  if (type === 'image') {
    return {
      fill: '#ecece9',
      opacity: 1,
      borderColor: '#d9d9d5',
      borderWidth: 1,
      borderStyle: 'solid',
      borderRadius: 8,
      color: '#171717',
      fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: 'left',
    };
  }
  if (type === 'line' || type === 'arrow') {
    return {
      fill: 'transparent',
      opacity: 1,
      borderColor: '#171717',
      borderWidth: 2,
      borderStyle: 'solid',
      borderRadius: 0,
      color: '#171717',
      fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      textAlign: 'left',
    };
  }
  return {
    fill: '#deded9',
    opacity: 1,
    borderColor: 'transparent',
    borderWidth: 0,
    borderStyle: 'solid',
    borderRadius: 10,
    color: '#171717',
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: 'left',
  };
}

export function defaultLayout(): LayoutStyle {
  return {
    mode: 'free',
    gap: 16,
    padding: 24,
    alignItems: 'start',
    justifyContent: 'start',
    clipContent: false,
    wrap: false,
  };
}

type MakeNodeInput = Pick<DesignNode, 'id' | 'type' | 'name' | 'pageId' | 'parentId' | 'x' | 'y' | 'width' | 'height'> & {
  isGroup?: boolean;
  sizing?: DesignNode['sizing'];
  childIds?: string[];
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  shape?: DesignNode['shape'];
  content?: string;
  image?: DesignNode['image'];
  hidden?: boolean;
  locked?: boolean;
  binding?: DesignNode['binding'];
  annotations?: LayerAnnotation[];
  rotation?: number;
};

export function makeNode(input: MakeNodeInput): DesignNode {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    ...(input.isGroup ? { isGroup: true } : {}),
    pageId: input.pageId,
    parentId: input.parentId,
    childIds: input.childIds ? [...input.childIds] : [],
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    sizing: input.sizing ? deepClone(input.sizing) : undefined,
    style: { ...defaultNodeStyle(input.type), ...input.style },
    layout: input.layout ? { ...defaultLayout(), ...input.layout } : input.type === 'artboard' || input.type === 'frame' ? defaultLayout() : undefined,
    shape: input.shape ? deepClone(input.shape) : input.type === 'polygon' ? { sides: 6 } : undefined,
    content: input.content,
    image: input.image ? deepClone(input.image) : undefined,
    hidden: input.hidden ?? false,
    locked: input.locked ?? false,
    binding: input.binding ? deepClone(input.binding) : undefined,
    annotations: input.annotations ? deepClone(input.annotations) : undefined,
    updatedAt: nowIso(),
  };
}

function addNode(document: DocumentModel, node: DesignNode): void {
  document.nodes[node.id] = node;
  const page = document.pages.find((candidate) => candidate.id === node.pageId);
  if (!page) return;
  if (node.parentId) {
    const parent = document.nodes[node.parentId];
    if (parent && !parent.childIds.includes(node.id)) parent.childIds.push(node.id);
  } else if (!page.rootIds.includes(node.id)) {
    page.rootIds.push(node.id);
  }
}

function seedText(
  id: string,
  pageId: string,
  parentId: string,
  name: string,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<NodeStyle>,
  binding?: DesignNode['binding'],
): DesignNode {
  return makeNode({ id, type: 'text', name, pageId, parentId, content, x, y, width, height, style, binding });
}

function seedRectangle(
  id: string,
  pageId: string,
  parentId: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<NodeStyle>,
): DesignNode {
  return makeNode({ id, type: 'rectangle', name, pageId, parentId, x, y, width, height, style });
}

function seedFrame(
  id: string,
  pageId: string,
  parentId: string | null,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<NodeStyle> = {},
  layout: Partial<LayoutStyle> = {},
): DesignNode {
  return makeNode({ id, type: 'frame', name, pageId, parentId, x, y, width, height, style, layout });
}

export function createInitialDocument(): DocumentModel {
  const pageId = 'page_canvas';
  const websiteId = 'artboard_website';
  const graphicId = 'artboard_graphic';
  const darkBrown = '#4A3328';
  const page: Page = { id: pageId, name: 'Canvas', rootIds: [] };
  const document: DocumentModel = {
    id: 'document_easel',
    name: 'After Hours Book Club',
    pages: [page],
    activePageId: pageId,
    nodes: {},
    assets: {},
    selection: { ids: [], primaryId: null },
    viewport: deepClone(DEFAULT_VIEWPORT),
    revision: 1,
    updatedAt: nowIso(),
  };

  addNode(document, makeNode({
    id: websiteId,
    type: 'artboard',
    name: 'Website',
    pageId,
    parentId: null,
    x: 80,
    y: 100,
    width: 880,
    height: 600,
    style: { fill: darkBrown, borderColor: '#6b4b3b', borderWidth: 1 },
  }));
  addNode(document, seedRectangle('website_background', pageId, websiteId, 'Website Background', 0, 0, 880, 600, { fill: darkBrown, borderColor: darkBrown, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedFrame('site_header', pageId, websiteId, 'Website header', 42, 30, 796, 34, { borderColor: '#6b4b3b', borderWidth: 0 }));
  addNode(document, seedText('site_wordmark', pageId, 'site_header', 'Website wordmark', 'THE READING ROOM', 0, 7, 220, 20, { fontSize: 11, fontWeight: 600, letterSpacing: 1.6, color: '#d6b59a' }));
  addNode(document, seedText('site_header_note', pageId, 'site_header', 'Website header note', 'A small gathering for curious readers', 490, 7, 306, 20, { fontSize: 11, fontWeight: 500, color: '#ad8e7a', textAlign: 'right' }));
  addNode(document, seedText('site_kicker', pageId, websiteId, 'Website kicker', 'AFTER HOURS · BOOK CLUB', 54, 94, 330, 20, { fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: '#c28e69' }));
  addNode(document, seedText('site_title', pageId, websiteId, 'Website Title', 'After Hours Book Club', 50, 128, 470, 142, { fontSize: 54, fontWeight: 600, lineHeight: 1.02, letterSpacing: -1.8, color: '#f6e9dc' }));
  addNode(document, seedText('site_date', pageId, websiteId, 'Website Date', 'Date TBA', 54, 360, 150, 30, { fontSize: 16, fontWeight: 600, color: '#f3ddca' }, { key: 'event.date', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Date TBA' }));
  addNode(document, seedText('site_time', pageId, websiteId, 'Website Time', 'Time TBA', 238, 360, 150, 30, { fontSize: 16, fontWeight: 600, color: '#f3ddca' }, { key: 'event.time', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Time TBA' }));
  addNode(document, seedText('site_location', pageId, websiteId, 'Website Venue', 'Venue TBA', 54, 410, 330, 26, { fontSize: 14, fontWeight: 500, color: '#d6b59a' }, { key: 'event.venue', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Venue TBA' }));
  addNode(document, seedRectangle('site_accent', pageId, websiteId, 'Website accent', 570, 100, 254, 350, { fill: '#604437', borderColor: '#87614e', borderWidth: 1, borderRadius: 18 }));
  addNode(document, seedText('site_accent_label', pageId, 'site_accent', 'Website accent label', 'A NIGHT FOR READERS', 28, 162, 198, 28, { fontSize: 12, fontWeight: 600, letterSpacing: 1.5, color: '#d6b59a', textAlign: 'center' }));
  addNode(document, seedFrame('site_meta', pageId, websiteId, 'Website details', 570, 474, 254, 70, { fill: '#604437', borderColor: '#87614e', borderWidth: 1, borderRadius: 16 }, { clipContent: true }));
  addNode(document, seedText('site_meta_label', pageId, 'site_meta', 'Website details label', 'DETAILS TO FOLLOW', 16, 24, 222, 20, { fontSize: 10, fontWeight: 600, letterSpacing: 1.1, color: '#c28e69', textAlign: 'center' }));

  addNode(document, makeNode({
    id: graphicId,
    type: 'artboard',
    name: 'Graphic',
    pageId,
    parentId: null,
    x: 1120,
    y: 100,
    width: 480,
    height: 600,
    style: { fill: darkBrown, borderColor: '#6b4b3b', borderWidth: 1 },
  }));
  addNode(document, seedRectangle('graphic_background', pageId, graphicId, 'Graphic Background', 0, 0, 480, 600, { fill: darkBrown, borderColor: darkBrown, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedText('graphic_kicker', pageId, graphicId, 'Graphic kicker', 'AFTER HOURS', 32, 34, 260, 24, { fontSize: 12, fontWeight: 600, letterSpacing: 1.8, color: '#c28e69' }));
  addNode(document, seedText('graphic_title', pageId, graphicId, 'Graphic Subtitle', 'Quiet books. Good company.', 32, 92, 400, 120, { fontSize: 42, fontWeight: 600, lineHeight: 1.02, letterSpacing: -1.3, color: '#f6e9dc' }));
  addNode(document, seedText('graphic_tagline', pageId, graphicId, 'Graphic Secondary Line', 'Bring a friend.', 34, 236, 380, 36, { fontSize: 15, fontWeight: 400, color: '#d6b59a' }));
  addNode(document, seedRectangle('graphic_image', pageId, graphicId, 'Graphic Image Area', 32, 318, 416, 194, { fill: '#604437', borderColor: '#b08368', borderWidth: 1, borderStyle: 'dashed', borderRadius: 18 }));
  addNode(document, seedText('graphic_image_hint', pageId, 'graphic_image', 'Graphic placeholder hint', 'IMAGE AREA', 122, 84, 172, 24, { fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: '#d6b59a', textAlign: 'center' }));
  addNode(document, seedText('graphic_date', pageId, graphicId, 'Graphic Date', 'Date TBA', 34, 548, 108, 24, { fontSize: 12, fontWeight: 600, color: '#f3ddca' }, { key: 'event.date', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Date TBA' }));
  addNode(document, seedText('graphic_time', pageId, graphicId, 'Graphic Time', 'Time TBA', 158, 548, 108, 24, { fontSize: 12, fontWeight: 600, color: '#f3ddca' }, { key: 'event.time', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Time TBA' }));
  addNode(document, seedText('graphic_location', pageId, graphicId, 'Graphic Venue', 'Venue TBA', 282, 548, 164, 24, { fontSize: 12, fontWeight: 500, color: '#d6b59a' }, { key: 'event.venue', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Venue TBA' }));

  document.selection = { ids: [websiteId], primaryId: websiteId };
  return document;
}

export function createInitialState(): EditorState {
  const document = createInitialDocument();
  return {
    document,
    files: [{ id: document.id, name: document.name, document: deepClone(document), updatedAt: document.updatedAt, open: true }],
    activeFileId: document.id,
    theme: 'light',
    panels: deepClone(DEFAULT_PANELS),
    history: [],
    future: [],
    lastAction: null,
    focus: null,
    preview: null,
  };
}

export function syncActiveFile(state: EditorState): EditorState {
  const activeFileId = state.activeFileId || state.document.id;
  const files = Array.isArray(state.files) ? state.files : [];
  const currentRecord = files.find((file) => file.id === activeFileId);
  const currentFile: EaselFile = { id: activeFileId, name: state.document.name, document: deepClone(state.document), updatedAt: state.document.updatedAt, open: true };
  if (currentRecord) currentFile.open = true;
  const index = files.findIndex((file) => file.id === activeFileId);
  const nextFiles = files.map((file) => file.id === activeFileId ? currentFile : file);
  if (index < 0) nextFiles.push(currentFile);
  return { ...state, activeFileId, files: nextFiles };
}

export function getPage(document: DocumentModel, pageId = document.activePageId): Page | undefined {
  return document.pages.find((page) => page.id === pageId);
}

export function getNode(document: DocumentModel, nodeId: string | null | undefined): DesignNode | undefined {
  return nodeId ? document.nodes[nodeId] : undefined;
}

export function getArtboards(document: DocumentModel, pageId = document.activePageId): DesignNode[] {
  const page = getPage(document, pageId);
  return page ? page.rootIds.map((id) => document.nodes[id]).filter((node): node is DesignNode => Boolean(node && node.type === 'artboard')) : [];
}

export function getFrames(document: DocumentModel, pageId = document.activePageId): DesignNode[] {
  return getArtboards(document, pageId);
}

export function getPageNodeIds(document: DocumentModel, pageId = document.activePageId): string[] {
  const page = getPage(document, pageId);
  if (!page) return [];
  const result: string[] = [];
  const visit = (id: string) => {
    const node = document.nodes[id];
    if (!node) return;
    result.push(id);
    node.childIds.forEach(visit);
  };
  page.rootIds.forEach(visit);
  return result;
}

export function getDescendantIds(document: DocumentModel, nodeId: string): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = document.nodes[id];
    if (!node) return;
    result.push(id);
    node.childIds.forEach(visit);
  };
  visit(nodeId);
  return result;
}

export function isDescendant(document: DocumentModel, nodeId: string, ancestorId: string): boolean {
  let current: DesignNode | undefined = document.nodes[nodeId];
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true;
    current = document.nodes[current.parentId];
  }
  return false;
}

/**
 * Canvas clicks target the nearest top-level logical group. Layer-panel clicks
 * deliberately bypass this helper so children remain independently editable.
 */
export function getCanvasSelectionId(document: DocumentModel, nodeId: string): string {
  let current = document.nodes[nodeId];
  let selectionId = nodeId;
  while (current?.parentId) {
    const parent = document.nodes[current.parentId];
    if (!parent) break;
    if (parent.type === 'frame' && (parent.isGroup || parent.name === 'Group')) selectionId = parent.id;
    current = parent;
  }
  return selectionId;
}

const MAX_LAYOUT_DIMENSION = 20000;
const MAX_LAYOUT_DEPTH = 100;
const MAX_LAYOUT_PASSES = 4;

function sizingMode(node: DesignNode, axis: 'width' | 'height'): SizingMode {
  return node.sizing?.[axis] ?? 'fixed';
}

function clampLayoutDimension(value: number): number {
  return Math.min(MAX_LAYOUT_DIMENSION, Math.max(1, Number.isFinite(value) ? value : 1));
}

function textMetrics(node: DesignNode, width: number): { width: number; height: number } {
  const content = node.content ?? '';
  const fontSize = Math.max(1, node.style.fontSize || 16);
  const lineHeight = Math.max(.5, node.style.lineHeight || 1.2);
  const letterWidth = Math.max(1, fontSize * .54 + node.style.letterSpacing);
  const border = Math.max(0, node.style.borderWidth) * 2;
  const naturalLines = content.split('\n').map((line) => line || ' ');
  const naturalWidth = Math.max(1, ...naturalLines.map((line) => line.length * letterWidth + border));
  const available = Math.max(1, width - border);
  const maxChars = Math.max(1, Math.floor(available / letterWidth));
  const lines = naturalLines.flatMap((line) => {
    if (line.length <= maxChars) return [line];
    const chunks: string[] = [];
    for (let index = 0; index < line.length; index += maxChars) chunks.push(line.slice(index, index + maxChars));
    return chunks;
  });
  return { width: clampLayoutDimension(naturalWidth), height: clampLayoutDimension(Math.max(fontSize * lineHeight + border, lines.length * fontSize * lineHeight + border)) };
}

function markLayoutChange(node: DesignNode, changed: Set<string>): void {
  changed.add(node.id);
  node.updatedAt = nowIso();
}

function setLayoutValue(node: DesignNode, key: 'x' | 'y' | 'width' | 'height', value: number, changed: Set<string>): void {
  const next = key === 'x' || key === 'y' ? value : clampLayoutDimension(value);
  if (Math.abs(node[key] - next) < .001) return;
  node[key] = next;
  markLayoutChange(node, changed);
}

function refreshIntrinsicNode(node: DesignNode, changed: Set<string>): void {
  if (node.type !== 'text') return;
  const metrics = textMetrics(node, node.width);
  if (sizingMode(node, 'width') === 'hug') setLayoutValue(node, 'width', metrics.width, changed);
  if (sizingMode(node, 'height') === 'hug') setLayoutValue(node, 'height', textMetrics(node, node.width).height, changed);
}

function childPreferredSize(node: DesignNode, axis: 'width' | 'height', parentAvailable: number | undefined, parentHugs: boolean): number {
  if (node.type === 'text' && sizingMode(node, axis) === 'hug') {
    const metrics = textMetrics(node, axis === 'width' ? node.width : node.width);
    return axis === 'width' ? metrics.width : metrics.height;
  }
  if (sizingMode(node, axis) === 'fill' && parentAvailable !== undefined && !parentHugs) return parentAvailable;
  return clampLayoutDimension(node[axis]);
}

function setChildFlowSize(node: DesignNode, width: number, height: number, changed: Set<string>): void {
  if (sizingMode(node, 'width') === 'fill') setLayoutValue(node, 'width', width, changed);
  else if (sizingMode(node, 'width') === 'hug' && node.type === 'text') setLayoutValue(node, 'width', textMetrics(node, node.width).width, changed);
  if (sizingMode(node, 'height') === 'fill') setLayoutValue(node, 'height', height, changed);
  else if (sizingMode(node, 'height') === 'hug' && node.type === 'text') setLayoutValue(node, 'height', textMetrics(node, node.width).height, changed);
}

function layoutRow(node: DesignNode, children: DesignNode[], changed: Set<string>): void {
  const layout = node.layout ?? defaultLayout();
  const padding = Math.max(0, layout.padding);
  const gap = Math.max(0, layout.gap);
  const widthHug = sizingMode(node, 'width') === 'hug';
  const heightHug = sizingMode(node, 'height') === 'hug';
  const preferredWidths = children.map((child) => childPreferredSize(child, 'width', undefined, widthHug));
  let contentWidth = Math.max(0, node.width - padding * 2);
  if (widthHug) {
    const intrinsicWidth = preferredWidths.reduce((total, width) => total + width, 0) + Math.max(0, children.length - 1) * gap;
    setLayoutValue(node, 'width', intrinsicWidth + padding * 2, changed);
    contentWidth = Math.max(0, node.width - padding * 2);
  }

  const lines: DesignNode[][] = [];
  let line: DesignNode[] = [];
  let lineWidth = 0;
  children.forEach((child, index) => {
    const preferred = preferredWidths[index];
    const nextWidth = line.length ? lineWidth + gap + preferred : preferred;
    if (layout.wrap && !widthHug && line.length && nextWidth > contentWidth) {
      lines.push(line);
      line = [];
      lineWidth = 0;
    }
    line.push(child);
    lineWidth = line.length === 1 ? preferred : lineWidth + gap + preferred;
  });
  if (line.length) lines.push(line);

  const lineHeights = lines.map((currentLine) => Math.max(1, ...currentLine.map((child) => childPreferredSize(child, 'height', undefined, heightHug))));
  if (heightHug) {
    const intrinsicHeight = lineHeights.reduce((total, height) => total + height, 0) + Math.max(0, lines.length - 1) * gap;
    setLayoutValue(node, 'height', intrinsicHeight + padding * 2, changed);
  }
  const contentHeight = Math.max(0, node.height - padding * 2);
  let cursorY = padding;
  lines.forEach((currentLine, lineIndex) => {
    const fixedWidth = currentLine.reduce((total, child) => total + (sizingMode(child, 'width') === 'fill' ? 0 : childPreferredSize(child, 'width', undefined, widthHug)), 0);
    const fillCount = currentLine.filter((child) => sizingMode(child, 'width') === 'fill').length;
    const availableForFill = Math.max(0, contentWidth - fixedWidth - Math.max(0, currentLine.length - 1) * gap);
    const fillWidth = fillCount ? Math.max(1, availableForFill / fillCount) : 0;
    const widths = currentLine.map((child) => sizingMode(child, 'width') === 'fill' && !widthHug ? fillWidth : childPreferredSize(child, 'width', undefined, widthHug));
    const lineWidthValue = widths.reduce((total, width) => total + width, 0) + Math.max(0, currentLine.length - 1) * gap;
    const free = Math.max(0, contentWidth - lineWidthValue);
    const justifyOffset = layout.justifyContent === 'center' ? free / 2 : layout.justifyContent === 'end' ? free : 0;
    const between = layout.justifyContent === 'space-between' && currentLine.length > 1 ? free / (currentLine.length - 1) : 0;
    const baseLineHeight = lineHeights[lineIndex] ?? 1;
    const lineHeight = layout.wrap ? baseLineHeight : Math.max(baseLineHeight, contentHeight);
    let cursorX = padding + justifyOffset;
    currentLine.forEach((child, index) => {
      const width = widths[index];
      const preferredHeight = childPreferredSize(child, 'height', undefined, heightHug);
      const height = sizingMode(child, 'height') === 'fill' && !heightHug ? lineHeight : preferredHeight;
      const crossOffset = layout.alignItems === 'center' ? Math.max(0, (lineHeight - height) / 2) : layout.alignItems === 'end' ? Math.max(0, lineHeight - height) : 0;
      setChildFlowSize(child, width, height, changed);
      setLayoutValue(child, 'x', cursorX, changed);
      setLayoutValue(child, 'y', cursorY + crossOffset, changed);
      cursorX += width + gap + between;
    });
    cursorY += lineHeight + gap;
  });
}

function layoutColumn(node: DesignNode, children: DesignNode[], changed: Set<string>): void {
  const layout = node.layout ?? defaultLayout();
  const padding = Math.max(0, layout.padding);
  const gap = Math.max(0, layout.gap);
  const widthHug = sizingMode(node, 'width') === 'hug';
  const heightHug = sizingMode(node, 'height') === 'hug';
  const preferredWidths = children.map((child) => childPreferredSize(child, 'width', undefined, widthHug));
  const preferredHeights = children.map((child) => childPreferredSize(child, 'height', undefined, heightHug));
  if (widthHug) setLayoutValue(node, 'width', Math.max(1, ...preferredWidths) + padding * 2, changed);
  if (heightHug) setLayoutValue(node, 'height', preferredHeights.reduce((total, height) => total + height, 0) + Math.max(0, children.length - 1) * gap + padding * 2, changed);
  const contentWidth = Math.max(0, node.width - padding * 2);
  const contentHeight = Math.max(0, node.height - padding * 2);
  const fixedHeight = preferredHeights.reduce((total, height, index) => total + (sizingMode(children[index], 'height') === 'fill' ? 0 : height), 0);
  const fillCount = children.filter((child) => sizingMode(child, 'height') === 'fill').length;
  const availableForFill = Math.max(0, contentHeight - fixedHeight - Math.max(0, children.length - 1) * gap);
  const fillHeight = fillCount ? Math.max(1, availableForFill / fillCount) : 0;
  const totalHeight = children.reduce((total, child, index) => total + (sizingMode(child, 'height') === 'fill' && !heightHug ? fillHeight : preferredHeights[index]), 0) + Math.max(0, children.length - 1) * gap;
  const free = Math.max(0, contentHeight - totalHeight);
  const justifyOffset = layout.justifyContent === 'center' ? free / 2 : layout.justifyContent === 'end' ? free : 0;
  const between = layout.justifyContent === 'space-between' && children.length > 1 ? free / (children.length - 1) : 0;
  let cursorY = padding + justifyOffset;
  children.forEach((child, index) => {
    const preferredWidth = preferredWidths[index];
    const width = sizingMode(child, 'width') === 'fill' && !widthHug ? contentWidth : preferredWidth;
    const height = sizingMode(child, 'height') === 'fill' && !heightHug ? fillHeight : preferredHeights[index];
    const crossOffset = layout.alignItems === 'center' ? Math.max(0, (contentWidth - width) / 2) : layout.alignItems === 'end' ? Math.max(0, contentWidth - width) : 0;
    setChildFlowSize(child, width, height, changed);
    setLayoutValue(child, 'x', padding + crossOffset, changed);
    setLayoutValue(child, 'y', cursorY, changed);
    cursorY += height + gap + between;
  });
}

function layoutContainer(document: DocumentModel, node: DesignNode, changed: Set<string>): void {
  const children = node.childIds.map((id) => document.nodes[id]).filter((child): child is DesignNode => Boolean(child && !child.hidden));
  if (!children.length || !node.layout || node.layout.mode === 'free') return;
  if (node.layout.mode === 'flex-row') layoutRow(node, children, changed);
  else layoutColumn(node, children, changed);
}

/** Materialize opted-in flex layout into node geometry for bounds, persistence, and export. */
export function materializeDocumentLayout(document: DocumentModel): string[] {
  const changed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (depth > MAX_LAYOUT_DEPTH || visiting.has(id)) return;
    const node = document.nodes[id];
    if (!node) return;
    visiting.add(id);
    node.childIds.forEach((childId) => visit(childId, depth + 1));
    refreshIntrinsicNode(node, changed);
    if (node.layout?.mode !== 'free') {
      for (let pass = 0; pass < MAX_LAYOUT_PASSES; pass += 1) {
        const before = changed.size;
        layoutContainer(document, node, changed);
        node.childIds.forEach((childId) => {
          const child = document.nodes[childId];
          if (child && (child.type === 'text' || child.layout?.mode !== 'free')) visit(childId, depth + 1);
        });
        if (changed.size === before) break;
      }
    }
    visiting.delete(id);
  };
  document.pages.forEach((page) => page.rootIds.forEach((id) => visit(id, 0)));
  return [...changed];
}

export function getAbsolutePosition(document: DocumentModel, nodeId: string): Point {
  const node = document.nodes[nodeId];
  if (!node || !node.parentId) return { x: node?.x ?? 0, y: node?.y ?? 0 };
  const parent = document.nodes[node.parentId];
  if (!parent) return { x: node.x, y: node.y };
  const parentPosition = getAbsolutePosition(document, parent.id);
  return { x: parentPosition.x + node.x, y: parentPosition.y + node.y };
}

export function getAbsoluteRect(document: DocumentModel, nodeId: string): { x: number; y: number; width: number; height: number; rotation: number } {
  const node = document.nodes[nodeId];
  if (!node) return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
  const position = getAbsolutePosition(document, nodeId);
  return { ...position, width: node.width, height: node.height, rotation: node.rotation };
}

export function getBoundingRect(document: DocumentModel, ids: string[]): { x: number; y: number; width: number; height: number } | null {
  const rects = ids.map((id) => getAbsoluteRect(document, id)).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getArtboardForNode(document: DocumentModel, nodeId: string): DesignNode | undefined {
  let node: DesignNode | undefined = document.nodes[nodeId];
  while (node) {
    if (node.type === 'artboard') return node;
    node = node.parentId ? document.nodes[node.parentId] : undefined;
  }
  return undefined;
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function hasSemanticTargetSelector(target: SemanticTarget): boolean {
  return target.frameId !== undefined || target.frameName !== undefined || target.artboardId !== undefined || target.artboardName !== undefined || target.name !== undefined || target.content !== undefined || target.bindingKey !== undefined;
}

export function matchesSemanticTarget(document: DocumentModel, node: DesignNode, target: SemanticTarget): boolean {
  if (target.pageId !== undefined && node.pageId !== target.pageId) return false;
  if (target.type !== undefined && !(target.type === 'frame' && (node.type === 'frame' || node.type === 'artboard')) && node.type !== target.type) return false;
  const artboard = getArtboardForNode(document, node.id);
  if (target.frameId !== undefined && artboard?.id !== target.frameId) return false;
  if (target.frameName !== undefined && (!artboard || artboard.name.trim().toLowerCase() !== target.frameName.trim().toLowerCase())) return false;
  if (target.artboardId !== undefined && artboard?.id !== target.artboardId) return false;
  if (target.artboardName !== undefined && (!artboard || artboard.name.trim().toLowerCase() !== target.artboardName.trim().toLowerCase())) return false;
  if (target.name !== undefined && node.name.trim().toLowerCase() !== target.name.trim().toLowerCase()) return false;
  if (target.content !== undefined && (node.content === undefined || normalizeLineEndings(node.content) !== normalizeLineEndings(target.content))) return false;
  if (target.bindingKey !== undefined && node.binding?.key !== target.bindingKey) return false;
  return true;
}

export function getSemanticTargetScopeNodes(document: DocumentModel, target: SemanticTarget): DesignNode[] {
  return getPageNodeIds(document, target.pageId ?? document.activePageId)
    .map((id) => document.nodes[id])
    .filter((node): node is DesignNode => Boolean(node));
}

export function getAncestorIds(document: DocumentModel, nodeId: string): string[] {
  const result: string[] = [];
  let node = document.nodes[nodeId];
  while (node?.parentId) {
    result.push(node.parentId);
    node = document.nodes[node.parentId];
  }
  return result;
}

export function getAsset(document: DocumentModel, assetId: string | undefined): ImageAsset | undefined {
  return assetId ? document.assets[assetId] : undefined;
}

export function addImageAsset(document: DocumentModel, asset: ImageAsset): void {
  document.assets[asset.id] = deepClone(asset);
}

export function ensurePreset(value: string): Size | undefined {
  return Object.prototype.hasOwnProperty.call(ARTBOARD_PRESETS, value) ? ARTBOARD_PRESETS[value as ArtboardPreset] : undefined;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampViewport(viewport: Viewport): Viewport {
  return { zoom: clamp(viewport.zoom, 0.18, 3), pan: { x: viewport.pan.x, y: viewport.pan.y } };
}

export function makeSnapshotState(state: EditorState): { document: DocumentModel; theme: EditorState['theme']; panels: PanelsState } {
  return { document: deepClone(state.document), theme: state.theme, panels: deepClone(state.panels) };
}

export function restoreSnapshot(state: EditorState, snapshot: { document: DocumentModel; theme: EditorState['theme']; panels: PanelsState }): EditorState {
  return { ...state, document: deepClone(snapshot.document), theme: snapshot.theme, panels: deepClone(snapshot.panels), focus: null, preview: null };
}

export function removeFromArray(items: string[], value: string): string[] {
  return items.filter((item) => item !== value);
}

export function insertAfter(items: string[], sourceId: string, value: string): string[] {
  const index = items.indexOf(sourceId);
  if (index < 0) return [...items, value];
  return [...items.slice(0, index + 1), value, ...items.slice(index + 1)];
}

export function setNodeUpdated(node: DesignNode): void {
  node.updatedAt = nowIso();
}

export function pageContainsNode(document: DocumentModel, pageId: string, nodeId: string): boolean {
  return getPageNodeIds(document, pageId).includes(nodeId);
}
