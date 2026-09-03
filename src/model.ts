import {
  ARTBOARD_PRESETS,
  type ArtboardPreset,
  type DesignNode,
  type DocumentModel,
  type EaselFile,
  type EditorState,
  type ImageAsset,
  type LayoutStyle,
  type NodeStyle,
  type NodeType,
  type Page,
  type PanelsState,
  type Point,
  type Size,
  type SemanticTarget,
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
  };
}

type MakeNodeInput = Pick<DesignNode, 'id' | 'type' | 'name' | 'pageId' | 'parentId' | 'x' | 'y' | 'width' | 'height'> & {
  childIds?: string[];
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  shape?: DesignNode['shape'];
  content?: string;
  image?: DesignNode['image'];
  hidden?: boolean;
  locked?: boolean;
  binding?: DesignNode['binding'];
  rotation?: number;
};

export function makeNode(input: MakeNodeInput): DesignNode {
  return {
    id: input.id,
    type: input.type,
    name: input.name,
    pageId: input.pageId,
    parentId: input.parentId,
    childIds: input.childIds ? [...input.childIds] : [],
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    style: { ...defaultNodeStyle(input.type), ...input.style },
    layout: input.layout ? { ...defaultLayout(), ...input.layout } : input.type === 'artboard' || input.type === 'frame' ? defaultLayout() : undefined,
    shape: input.shape ? deepClone(input.shape) : input.type === 'polygon' ? { sides: 6 } : undefined,
    content: input.content,
    image: input.image ? deepClone(input.image) : undefined,
    hidden: input.hidden ?? false,
    locked: input.locked ?? false,
    binding: input.binding ? deepClone(input.binding) : undefined,
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
  const paper = '#fbfaf7';
  const sand = '#e7e1d6';
  const ink = '#171717';
  const muted = '#6b6b6b';
  const brown = '#8b5e3c';
  const card = '#efede8';
  const rule = '#b8b5ae';
  const page: Page = { id: pageId, name: 'Canvas', rootIds: [] };
  const document: DocumentModel = {
    id: 'document_easel',
    name: 'Book Club',
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
    style: { fill: paper, borderColor: '#e8e5df', borderWidth: 1 },
  }));
  addNode(document, seedRectangle('website_background', pageId, websiteId, 'Website Background', 0, 0, 880, 600, { fill: paper, borderColor: paper, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedFrame('site_header', pageId, websiteId, 'Website header', 42, 30, 796, 34, { borderColor: '#e8e5df', borderWidth: 0 }));
  addNode(document, seedText('site_wordmark', pageId, 'site_header', 'Website wordmark', 'THE READING ROOM', 0, 7, 220, 20, { fontSize: 11, fontWeight: 600, letterSpacing: 1.6, color: brown }));
  addNode(document, seedText('site_nav_program', pageId, 'site_header', 'Website nav program', 'Program', 570, 7, 64, 20, { fontSize: 10, fontWeight: 500, color: muted, textAlign: 'right' }));
  addNode(document, seedText('site_nav_about', pageId, 'site_header', 'Website nav about', 'About', 654, 7, 54, 20, { fontSize: 10, fontWeight: 500, color: muted, textAlign: 'right' }));
  addNode(document, seedText('site_nav_signup', pageId, 'site_header', 'Website nav sign up', 'Sign up', 728, 7, 68, 20, { fontSize: 10, fontWeight: 600, color: ink, textAlign: 'right' }));
  addNode(document, seedText('site_kicker', pageId, websiteId, 'Website kicker', 'A GATHERING FOR CURIOUS MINDS', 54, 94, 360, 20, { fontSize: 11, fontWeight: 600, letterSpacing: 1.5, color: brown }));
  addNode(document, seedText('site_title', pageId, websiteId, 'Website Title', 'Make room for\nmore ideas.', 50, 128, 470, 142, { fontSize: 54, fontWeight: 600, lineHeight: 1.02, letterSpacing: -1.8, color: ink }));
  addNode(document, seedText('site_body', pageId, websiteId, 'Website intro copy', 'A small gathering for curious readers, good stories, and the ideas that stay with us.', 54, 302, 350, 64, { fontSize: 14, fontWeight: 400, lineHeight: 1.4, color: muted }));
  addNode(document, seedRectangle('site_cta', pageId, websiteId, 'Website action', 54, 382, 112, 36, { fill: ink, borderColor: ink, borderWidth: 0, borderRadius: 18 }));
  addNode(document, seedText('site_cta_label', pageId, 'site_cta', 'Website action label', 'Learn more', 10, 9, 92, 18, { color: '#ffffff', fontSize: 11, fontWeight: 600, textAlign: 'center' }));
  addNode(document, seedRectangle('site_accent', pageId, websiteId, 'Website details card', 520, 152, 254, 210, { fill: card, borderColor: card, borderWidth: 0, borderRadius: 12 }));
  addNode(document, seedText('site_date', pageId, 'site_accent', 'Website Date', 'Friday, 19 September 2025', 20, 24, 214, 18, { fontSize: 11, fontWeight: 600, lineHeight: 1.2, color: ink }, { key: 'event.date', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Friday, 19 September 2025' }));
  addNode(document, seedText('site_time', pageId, 'site_accent', 'Website Time', '7:00 PM', 20, 44, 214, 18, { fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: ink }, { key: 'event.time', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: '7:00 PM' }));
  addNode(document, seedText('site_location', pageId, 'site_accent', 'Website Venue', 'The Reading Room · 2nd Street', 20, 86, 214, 18, { fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: ink }, { key: 'event.venue', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'The Reading Room · 2nd Street' }));
  addNode(document, seedText('site_accent_note', pageId, 'site_accent', 'Website card note', 'Turn up for a shared reset.', 20, 128, 214, 18, { fontSize: 10, fontWeight: 400, lineHeight: 1.2, color: muted }));
  addNode(document, seedRectangle('site_rule', pageId, websiteId, 'Website rule', 54, 520, 772, 1, { fill: rule, borderColor: rule, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedText('site_footer', pageId, websiteId, 'Website footer', 'A small gathering for curious readers.', 54, 540, 300, 18, { fontSize: 10, fontWeight: 500, color: muted }));

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
    style: { fill: sand, borderColor: '#ded8cc', borderWidth: 1 },
  }));
  addNode(document, seedRectangle('graphic_background', pageId, graphicId, 'Graphic Background', 0, 0, 480, 600, { fill: sand, borderColor: sand, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedText('graphic_kicker', pageId, graphicId, 'Graphic kicker', 'THE READING ROOM / 2025', 32, 34, 300, 24, { fontSize: 11, fontWeight: 600, letterSpacing: 1.8, color: brown }));
  addNode(document, seedText('graphic_title', pageId, graphicId, 'Graphic Subtitle', 'Make room\nfor new ideas.', 32, 92, 400, 120, { fontSize: 42, fontWeight: 600, lineHeight: 1.02, letterSpacing: -1.3, color: ink }));
  addNode(document, seedRectangle('graphic_rule', pageId, graphicId, 'Graphic rule', 32, 238, 416, 2, { fill: rule, borderColor: rule, borderWidth: 0, borderRadius: 0 }));
  addNode(document, seedText('graphic_date', pageId, graphicId, 'Graphic Date', 'Friday, 19 September 2025', 32, 256, 224, 18, { fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: ink }, { key: 'event.date', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'Friday, 19 September 2025' }));
  addNode(document, seedText('graphic_time', pageId, graphicId, 'Graphic Time', '7:00 PM', 266, 256, 100, 18, { fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: ink }, { key: 'event.time', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: '7:00 PM' }));
  addNode(document, seedText('graphic_location', pageId, graphicId, 'Graphic Venue', 'The Reading Room · 2nd Street', 32, 282, 320, 18, { fontSize: 11, fontWeight: 500, lineHeight: 1.2, color: ink }, { key: 'event.venue', sourceLabel: 'Book Club brief', lastUpdatedAt: nowIso(), sharedValue: 'The Reading Room · 2nd Street' }));
  addNode(document, makeNode({ id: 'graphic_image', type: 'rectangle', name: 'Graphic Image Area', pageId, parentId: graphicId, x: 32, y: 318, width: 416, height: 194, hidden: true, style: { fill: 'transparent', borderColor: 'transparent', borderWidth: 0 } }));
  addNode(document, makeNode({ id: 'graphic_image_hint', type: 'text', name: 'Graphic placeholder hint', pageId, parentId: 'graphic_image', x: 122, y: 84, width: 172, height: 24, hidden: true, content: 'IMAGE AREA', style: { color: brown, fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textAlign: 'center' } }));
  addNode(document, seedRectangle('graphic_action', pageId, graphicId, 'Graphic action', 328, 514, 120, 54, { fill: ink, borderColor: ink, borderWidth: 0, borderRadius: 27 }));
  addNode(document, seedText('graphic_action_label', pageId, 'graphic_action', 'Graphic action label', 'SAVE\nYOUR SEAT', 14, 14, 92, 28, { color: '#ffffff', fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.1, letterSpacing: 0.8 }));
  addNode(document, seedText('graphic_tagline', pageId, graphicId, 'Graphic Secondary Line', 'Leave with a clearer next step.', 32, 550, 260, 18, { fontSize: 10, fontWeight: 500, color: muted }));

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

function alignedOffset(parent: DesignNode, child: DesignNode, axisSize: number): number {
  const contentSize = parent.layout?.mode === 'flex-row' || parent.layout?.mode === 'flex-column'
    ? Math.max(0, axisSize - 2 * (parent.layout.padding ?? 0))
    : axisSize;
  if (parent.layout?.alignItems === 'center') return Math.max(0, (contentSize - child.height) / 2);
  if (parent.layout?.alignItems === 'end') return Math.max(0, contentSize - child.height);
  if (parent.layout?.alignItems === 'stretch') return 0;
  return 0;
}

export function getAbsolutePosition(document: DocumentModel, nodeId: string): Point {
  const node = document.nodes[nodeId];
  if (!node || !node.parentId) return { x: node?.x ?? 0, y: node?.y ?? 0 };
  const parent = document.nodes[node.parentId];
  if (!parent) return { x: node.x, y: node.y };
  const parentPosition = getAbsolutePosition(document, parent.id);
  const mode = parent.layout?.mode ?? 'free';
  if (mode === 'free') return { x: parentPosition.x + node.x, y: parentPosition.y + node.y };
  const childIndex = parent.childIds.indexOf(node.id);
  const visibleSiblings = parent.childIds.slice(0, childIndex).map((id) => document.nodes[id]).filter((candidate): candidate is DesignNode => Boolean(candidate && !candidate.hidden));
  const gap = parent.layout?.gap ?? 0;
  const padding = parent.layout?.padding ?? 0;
  const mainOffset = visibleSiblings.reduce((total, sibling) => total + (mode === 'flex-row' ? sibling.width : sibling.height) + gap, 0);
  let justifyOffset = 0;
  const allVisible = parent.childIds.map((id) => document.nodes[id]).filter((candidate): candidate is DesignNode => Boolean(candidate && !candidate.hidden));
  const totalMain = allVisible.reduce((total, sibling) => total + (mode === 'flex-row' ? sibling.width : sibling.height), 0) + Math.max(0, allVisible.length - 1) * gap;
  const availableMain = Math.max(0, (mode === 'flex-row' ? parent.width : parent.height) - padding * 2);
  if (parent.layout?.justifyContent === 'center') justifyOffset = Math.max(0, (availableMain - totalMain) / 2);
  if (parent.layout?.justifyContent === 'end') justifyOffset = Math.max(0, availableMain - totalMain);
  if (parent.layout?.justifyContent === 'space-between' && allVisible.length > 1) {
    const extra = Math.max(0, availableMain - allVisible.reduce((total, sibling) => total + (mode === 'flex-row' ? sibling.width : sibling.height), 0));
    justifyOffset = 0;
    const between = extra / (allVisible.length - 1);
    const siblingIndex = visibleSiblings.length;
    const extraBefore = siblingIndex * (between - gap);
    if (mode === 'flex-row') return { x: parentPosition.x + padding + mainOffset + justifyOffset + extraBefore, y: parentPosition.y + padding + alignedOffset(parent, node, parent.height) };
    return { x: parentPosition.x + padding + alignedOffset(parent, node, parent.width), y: parentPosition.y + padding + mainOffset + justifyOffset + extraBefore };
  }
  if (mode === 'flex-row') return { x: parentPosition.x + padding + mainOffset + justifyOffset, y: parentPosition.y + padding + alignedOffset(parent, node, parent.height) };
  return { x: parentPosition.x + padding + alignedOffset(parent, node, parent.width), y: parentPosition.y + padding + mainOffset + justifyOffset };
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
