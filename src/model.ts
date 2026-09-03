import {
  ARTBOARD_PRESETS,
  type ArtboardPreset,
  type DesignNode,
  type DocumentModel,
  type EditorState,
  type ImageAsset,
  type LayoutStyle,
  type NodeStyle,
  type NodeType,
  type Page,
  type PanelsState,
  type Point,
  type Size,
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

export const DEFAULT_PANELS: PanelsState = {
  leftOpen: true,
  rightOpen: true,
};

export function defaultNodeStyle(type: NodeType): NodeStyle {
  if (type === 'text') {
    return {
      fill: 'transparent',
      opacity: 1,
      borderColor: 'transparent',
      borderWidth: 0,
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
  return {
    fill: '#deded9',
    opacity: 1,
    borderColor: 'transparent',
    borderWidth: 0,
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
  const pageId = 'page_launch';
  const websiteId = 'artboard_website';
  const posterId = 'artboard_poster';
  const page: Page = { id: pageId, name: 'Launch set', rootIds: [] };
  const document: DocumentModel = {
    id: 'document_easel',
    name: 'Untitled design',
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
    name: 'Website desktop',
    pageId,
    parentId: null,
    x: 80,
    y: 100,
    width: ARTBOARD_PRESETS['website-desktop'].width,
    height: ARTBOARD_PRESETS['website-desktop'].height,
    style: { fill: '#fbfaf7' },
  }));
  addNode(document, seedFrame('site_header', pageId, websiteId, 'Navigation', 52, 34, 1336, 52, { borderColor: '#e8e5df', borderWidth: 0 }));
  addNode(document, seedText('site_wordmark', pageId, 'site_header', 'Wordmark', 'FIELD NOTES', 0, 14, 180, 24, { fontSize: 13, fontWeight: 600, letterSpacing: 1.8 }));
  addNode(document, seedText('site_nav_one', pageId, 'site_header', 'Nav one', 'Program', 1000, 14, 90, 24, { fontSize: 13, fontWeight: 500, color: '#6b6b6b' }));
  addNode(document, seedText('site_nav_two', pageId, 'site_header', 'Nav two', 'Details', 1110, 14, 90, 24, { fontSize: 13, fontWeight: 500, color: '#6b6b6b' }));
  addNode(document, seedText('site_nav_three', pageId, 'site_header', 'Nav three', 'Register', 1220, 14, 110, 24, { fontSize: 13, fontWeight: 600 }));
  addNode(document, seedText('site_kicker', pageId, websiteId, 'Kicker', 'A GATHERING FOR CURIOUS MAKERS', 88, 184, 430, 24, { fontSize: 13, fontWeight: 600, letterSpacing: 1.7, color: '#8b5e3c' }));
  addNode(document, seedText('site_title', pageId, websiteId, 'Event title', 'Make room for\nnew ideas.', 84, 232, 720, 190, { fontSize: 78, fontWeight: 600, lineHeight: 1.02, letterSpacing: -2.2 }, { key: 'event.title', sourceLabel: 'Working brief', lastUpdatedAt: nowIso(), sharedValue: 'Make room for\nnew ideas.' }));
  addNode(document, seedText('site_body', pageId, websiteId, 'Intro copy', 'A two-day studio of talks, working sessions, and generous questions. Bring the thing you are still figuring out.', 92, 460, 390, 76, { fontSize: 17, fontWeight: 400, lineHeight: 1.45, color: '#5f5c57' }));
  addNode(document, seedRectangle('site_cta', pageId, websiteId, 'Primary button', 92, 582, 190, 58, { fill: '#171717', borderRadius: 29 }));
  addNode(document, seedText('site_cta_label', pageId, 'site_cta', 'Button label', 'Save a seat', 34, 18, 122, 24, { color: '#ffffff', fontSize: 14, fontWeight: 600, textAlign: 'center' }));
  addNode(document, seedFrame('site_meta', pageId, websiteId, 'Event facts', 850, 246, 414, 320, { fill: '#efede8', borderRadius: 18 }, { clipContent: true }));
  addNode(document, seedText('site_meta_label', pageId, 'site_meta', 'Facts label', 'THE SHORT VERSION', 36, 36, 210, 20, { fontSize: 12, fontWeight: 600, letterSpacing: 1.4, color: '#8b5e3c' }));
  addNode(document, seedText('site_date', pageId, 'site_meta', 'Event date', '16–18 September 2026', 36, 86, 340, 42, { fontSize: 25, fontWeight: 500 }, { key: 'event.date', sourceLabel: 'Calendar', lastUpdatedAt: nowIso(), sharedValue: '16–18 September 2026' }));
  addNode(document, seedText('site_location', pageId, 'site_meta', 'Event location', 'Riverside Hall · Pune', 36, 148, 340, 34, { fontSize: 16, fontWeight: 500 }, { key: 'event.location', sourceLabel: 'Calendar', lastUpdatedAt: nowIso(), sharedValue: 'Riverside Hall · Pune' }));
  addNode(document, seedText('site_approved', pageId, 'site_meta', 'Approved line', '“Leave with a clearer next step.”', 36, 224, 340, 54, { fontSize: 16, fontWeight: 500, lineHeight: 1.35 }, { key: 'approved.heading', sourceLabel: 'Review notes', lastUpdatedAt: nowIso(), sharedValue: '“Leave with a clearer next step.”' }));
  addNode(document, seedFrame('site_footer', pageId, websiteId, 'Footer', 88, 812, 1264, 1, { fill: '#171717' }));

  addNode(document, makeNode({
    id: posterId,
    type: 'artboard',
    name: 'Poster portrait',
    pageId,
    parentId: null,
    x: 1700,
    y: 100,
    width: ARTBOARD_PRESETS['poster-portrait'].width,
    height: ARTBOARD_PRESETS['poster-portrait'].height,
    style: { fill: '#e7e1d6' },
  }));
  addNode(document, seedText('poster_kicker', pageId, posterId, 'Poster kicker', 'FIELD NOTES / 2026', 86, 82, 400, 32, { fontSize: 15, fontWeight: 600, letterSpacing: 2, color: '#6e5038' }));
  addNode(document, seedText('poster_title', pageId, posterId, 'Poster title', 'Make room\nfor new ideas.', 82, 276, 820, 252, { fontSize: 96, fontWeight: 600, lineHeight: 0.98, letterSpacing: -3.4 }, { key: 'event.title', sourceLabel: 'Working brief', lastUpdatedAt: nowIso(), sharedValue: 'Make room\nfor new ideas.' }));
  addNode(document, seedRectangle('poster_rule', pageId, posterId, 'Poster rule', 88, 606, 904, 3, { fill: '#171717' }));
  addNode(document, seedText('poster_date', pageId, posterId, 'Poster date', '16–18 SEP 2026', 86, 674, 430, 34, { fontSize: 21, fontWeight: 600, letterSpacing: 1.4 }, { key: 'event.date', sourceLabel: 'Calendar', lastUpdatedAt: nowIso(), sharedValue: '16–18 September 2026' }));
  addNode(document, seedText('poster_location', pageId, posterId, 'Poster location', 'RIVERSIDE HALL · PUNE', 86, 728, 620, 30, { fontSize: 16, fontWeight: 500, letterSpacing: 1.2, color: '#6e5038' }, { key: 'event.location', sourceLabel: 'Calendar', lastUpdatedAt: nowIso(), sharedValue: 'Riverside Hall · Pune' }));
  addNode(document, seedFrame('poster_stamp', pageId, posterId, 'Poster stamp', 730, 1110, 250, 120, { fill: '#171717', borderRadius: 60 }));
  addNode(document, seedText('poster_stamp_text', pageId, 'poster_stamp', 'Stamp label', 'SAVE\nYOUR SEAT', 32, 30, 186, 58, { color: '#ffffff', fontSize: 17, fontWeight: 600, textAlign: 'center', lineHeight: 1.1, letterSpacing: 1.2 }));
  addNode(document, seedText('poster_approved', pageId, posterId, 'Poster approved line', 'Leave with a clearer next step.', 86, 1198, 650, 40, { fontSize: 19, fontWeight: 500 }, { key: 'approved.heading', sourceLabel: 'Review notes', lastUpdatedAt: nowIso(), sharedValue: '“Leave with a clearer next step.”' }));

  document.selection = { ids: [websiteId], primaryId: websiteId };
  return document;
}

export function createInitialState(): EditorState {
  return {
    document: createInitialDocument(),
    theme: 'light',
    panels: deepClone(DEFAULT_PANELS),
    history: [],
    future: [],
    lastAction: null,
    focus: null,
    preview: null,
  };
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
