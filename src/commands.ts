import {
  type ActionSource,
  type ArtboardPreset,
  type DesignNode,
  type DocumentModel,
  type EditorState,
  type ElementPatch,
  type ElementSpec,
  type HistoryEntry,
  type HistoryRequest,
  type ImageMetadata,
  type ImageAsset,
  type LayerAnnotation,
  type LayoutStyle,
  type MutationOutcome,
  type NodeSizing,
  type NodeStyle,
  type NodeType,
  type Page,
  type Point,
  type SemanticTarget,
  type ThemeMode,
  type Viewport,
} from './types';
import {
  clamp,
  clampViewport,
  createId,
  deepClone,
  defaultLayout,
  defaultNodeStyle,
  ensurePreset,
  getAbsolutePosition,
  getAbsoluteRect,
  getArtboardForNode,
  getBoundingRect,
  getDescendantIds,
  getPage,
  getPageNodeIds,
  getSemanticTargetScopeNodes,
  hasSemanticTargetSelector,
  insertAfter,
  isDescendant,
  materializeDocumentLayout,
  makeNode,
  makeSnapshotState,
  matchesSemanticTarget,
  nowIso,
  removeFromArray,
  restoreSnapshot,
  setNodeUpdated,
} from './model';

export class CommandError extends Error {
  code: string;
  affectedIds: string[];
  details?: Record<string, unknown>;

  constructor(code: string, message: string, affectedIds: string[] = [], details?: Record<string, unknown>) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
    this.affectedIds = affectedIds;
    this.details = details;
  }
}

export type ValidationIssue = {
  id: string;
  type: 'overflow' | 'missing-image' | 'empty-text' | 'dimensions' | 'inconsistent-binding' | 'locked-conflict' | 'hidden-critical' | 'export';
  severity: 'error' | 'warning';
  message: string;
  affectedIds: string[];
};

export type ValidationReport = {
  valid: boolean;
  revision: number;
  scope: string;
  issues: ValidationIssue[];
  counts: Record<ValidationIssue['type'], number>;
  checkedNodeCount: number;
};

export type CreateArtboardInput = {
  name: string;
  width?: number;
  height?: number;
  preset?: ArtboardPreset;
  position?: Point;
};

export type CreateFrameInput = CreateArtboardInput;

export type InsertTarget = {
  pageId?: string;
  artboardId?: string;
  frameId?: string;
  parentId?: string;
};

export type WriteArtboardInput = {
  artboardId: string;
  mode: 'append' | 'replace';
  elements: ElementSpec[];
  force?: boolean;
};

export type InsertElementsInput = InsertTarget & {
  elements: ElementSpec[];
};

export type UpdateElementsInput = {
  force?: boolean;
} & (
  { updates: ElementPatch[]; history?: never }
  | { history: HistoryRequest; updates?: never }
);

export type DuplicateInput = {
  ids: string[];
  offset?: Point;
  force?: boolean;
};

export type DeleteInput = {
  ids: string[];
  force?: boolean;
};

export type ContextValue = string | { assetId: string; label?: string; alt?: string };

export type ApplyContextInput = {
  values: Array<{ key: string; value: ContextValue }>;
  force?: boolean;
};

export type PlaceAssetInput = {
  asset?: ImageAsset;
  assetId?: string;
  frameId: string;
  position: Point;
  width?: number;
  height?: number;
  name?: string;
  alt?: string;
};

export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';

export type LayerReorderInput = {
  id: string;
  beforeId: string | null;
};

export type Command =
  | { type: 'set-document-name'; name: string; source?: ActionSource }
  | { type: 'create-page'; name?: string; source?: ActionSource }
  | { type: 'rename-page'; pageId: string; name: string; source?: ActionSource }
  | { type: 'delete-page'; pageId: string; source?: ActionSource }
  | ({ type: 'create-artboard'; source?: ActionSource } & CreateArtboardInput)
  | ({ type: 'insert-elements'; source?: ActionSource } & InsertElementsInput)
  | ({ type: 'write-artboard'; source?: ActionSource } & WriteArtboardInput)
  | ({ type: 'update-elements'; source?: ActionSource } & UpdateElementsInput)
  | ({ type: 'duplicate-elements'; source?: ActionSource } & DuplicateInput)
  | ({ type: 'delete-elements'; source?: ActionSource } & DeleteInput)
  | { type: 'rename-node'; id: string; name: string; source?: ActionSource }
  | { type: 'toggle-hidden'; ids: string[]; hidden?: boolean; source?: ActionSource }
  | { type: 'toggle-locked'; ids: string[]; locked?: boolean; source?: ActionSource }
  | { type: 'add-annotation'; nodeId: string; text: string; source?: ActionSource }
  | { type: 'update-annotation'; nodeId: string; annotationId: string; text?: string; resolved?: boolean; source?: ActionSource }
  | { type: 'delete-annotation'; nodeId: string; annotationId: string; source?: ActionSource }
  | { type: 'reorder-elements'; ids: string[]; direction: ReorderDirection; source?: ActionSource }
  | ({ type: 'reorder-layer'; source?: ActionSource } & LayerReorderInput)
  | { type: 'align-elements'; ids: string[]; alignment: 'left' | 'right' | 'top' | 'bottom' | 'horizontal-center' | 'vertical-center'; source?: ActionSource }
  | { type: 'distribute-elements'; ids: string[]; axis: 'horizontal' | 'vertical'; source?: ActionSource }
  | { type: 'group-elements'; ids: string[]; source?: ActionSource }
  | { type: 'ungroup-elements'; ids: string[]; source?: ActionSource }
  | { type: 'bind-context'; bindings: Array<{ nodeId: string; key: string; sourceLabel?: string }>; source?: ActionSource }
  | ({ type: 'apply-context' } & ApplyContextInput & { source?: ActionSource })
  | { type: 'unbind-context'; ids: string[]; source?: ActionSource }
  | { type: 'insert-image-asset'; asset: ImageAsset; position: Point; source?: ActionSource }
  | { type: 'import-asset'; asset: ImageAsset; source?: ActionSource }
  | ({ type: 'place-asset'; source?: ActionSource } & PlaceAssetInput)
  | { type: 'set-selection'; ids: string[]; additive?: boolean }
  | { type: 'set-viewport'; viewport: Viewport }
  | { type: 'set-theme'; theme: ThemeMode }
  | { type: 'undo' }
  | { type: 'redo' };

type MutationFn = (document: DocumentModel) => MutationOutcome;

const MAX_NAME_LENGTH = 120;
const MAX_TEXT_LENGTH = 6000;
const MAX_NODE_DIMENSION = 20000;
const SAFE_COLOR = /^(transparent|currentColor|#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)|[a-zA-Z]+)$/;

function ensureString(value: unknown, field: string, maximum = MAX_NAME_LENGTH): string {
  if (typeof value !== 'string') throw new CommandError('INVALID_INPUT', `${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new CommandError('INVALID_INPUT', `${field} cannot be empty.`);
  if (trimmed.length > maximum) throw new CommandError('INVALID_INPUT', `${field} must be at most ${maximum} characters.`);
  return trimmed;
}

function ensureFinite(value: unknown, field: string, minimum = -MAX_NODE_DIMENSION, maximum = MAX_NODE_DIMENSION): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CommandError('INVALID_INPUT', `${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function ensureDimension(value: unknown, field: string): number {
  return ensureFinite(value, field, 1, MAX_NODE_DIMENSION);
}

function safeColor(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 80 || !SAFE_COLOR.test(value)) {
    throw new CommandError('UNSAFE_STYLE', `${field} must be a simple CSS color.`);
  }
  return value;
}

function copySelectionIds(state: EditorState): string[] {
  return state.document.selection.ids.filter((id) => Boolean(state.document.nodes[id]));
}

function isEffectivelyLocked(document: DocumentModel, nodeId: string): boolean {
  let current: DesignNode | undefined = document.nodes[nodeId];
  while (current) {
    if (current.locked) return true;
    current = current.parentId ? document.nodes[current.parentId] : undefined;
  }
  return false;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function makeMutation(
  state: EditorState,
  label: string,
  source: ActionSource,
  mutate: MutationFn,
): EditorState {
  const document = deepClone(state.document);
  const outcome = mutate(document);
  const layoutChangedIds = materializeDocumentLayout(document);
  outcome.changedIds = uniqueIds([...outcome.changedIds, ...layoutChangedIds]);
  if (!outcome.changedIds.length && !outcome.skippedIds.length && !outcome.failedIds?.length) return state;
  const previous = makeSnapshotState(state);
  document.revision = state.document.revision + 1;
  document.updatedAt = nowIso();
  const actionLabel = outcome.message || label;
  const entry: HistoryEntry = { ...previous, label: actionLabel };
  return {
    ...state,
    document,
    history: [...state.history.slice(-(100 - 1)), entry],
    future: [],
    lastAction: {
      id: createId('action'),
      label: actionLabel,
      source,
      changedIds: [...outcome.changedIds],
      skippedIds: [...outcome.skippedIds],
      failedIds: [...(outcome.failedIds ?? [])],
      result: outcome.result,
      at: Date.now(),
    },
    focus: null,
    preview: null,
  };
}

function noOpOutcome(document: DocumentModel, message: string, skippedIds: string[] = []): MutationOutcome {
  return { document, changedIds: [], skippedIds, message };
}

function assertPage(document: DocumentModel, pageId: string): Page {
  const page = getPage(document, pageId);
  if (!page) throw new CommandError('CANVAS_NOT_FOUND', `No Canvas has the ID “${pageId}”.`, [pageId]);
  return page;
}

function assertNode(document: DocumentModel, id: string): DesignNode {
  const node = document.nodes[id];
  if (!node) throw new CommandError('NODE_NOT_FOUND', `No element has the ID “${id}”.`, [id]);
  return node;
}

function assertArtboard(document: DocumentModel, id: string): DesignNode {
  const node = assertNode(document, id);
  if (node.type !== 'artboard') throw new CommandError('NOT_A_FRAME', `Element “${id}” is not a Frame.`, [id]);
  return node;
}

function semanticCandidate(document: DocumentModel, node: DesignNode): Record<string, unknown> {
  const artboard = getArtboardForNode(document, node.id);
  return { id: node.id, name: node.name, type: node.type, frame: artboard ? { id: artboard.id, name: artboard.name } : null };
}

export function resolveSemanticTarget(document: DocumentModel, target: SemanticTarget): string {
  if (!hasSemanticTargetSelector(target)) throw new CommandError('INVALID_TARGET', 'A semantic target needs frameId, frameName, name, content, or bindingKey.', [], { target });
  const scoped = getSemanticTargetScopeNodes(document, target);
  const matches = scoped.filter((node) => matchesSemanticTarget(document, node, target));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const candidates = matches.slice(0, 8).map((node) => semanticCandidate(document, node));
    throw new CommandError('AMBIGUOUS_TARGET', `The semantic target matched ${matches.length} Layers. Add an exact Frame or name filter.`, matches.map((node) => node.id), { target, matchCount: matches.length, candidates });
  }
  const targetArtboard = target.frameId ? document.nodes[target.frameId] : target.artboardId ? document.nodes[target.artboardId] : undefined;
  const nearby = scoped
    .filter((node) => target.type === undefined || node.type === target.type)
    .filter((node) => !targetArtboard || node.id === targetArtboard.id || getArtboardForNode(document, node.id)?.id === targetArtboard.id)
    .slice(0, 8)
    .map((node) => semanticCandidate(document, node));
  throw new CommandError('NOT_FOUND', 'No element matched the semantic target.', [], { target, matchCount: 0, candidates: nearby });
}

function removeNodeFromParent(document: DocumentModel, node: DesignNode): void {
  const page = getPage(document, node.pageId);
  if (node.parentId) {
    const parent = document.nodes[node.parentId];
    if (parent) parent.childIds = removeFromArray(parent.childIds, node.id);
  } else if (page) {
    page.rootIds = removeFromArray(page.rootIds, node.id);
  }
}

function deleteSubtree(document: DocumentModel, id: string): string[] {
  const node = document.nodes[id];
  if (!node) return [];
  const ids = getDescendantIds(document, id);
  removeNodeFromParent(document, node);
  ids.forEach((nodeId) => delete document.nodes[nodeId]);
  return ids;
}

function nextPlacement(document: DocumentModel, pageId: string): Point {
  const roots = assertPage(document, pageId).rootIds.map((id) => document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
  const artboards = roots.filter((node) => node.type === 'artboard');
  if (!artboards.length) return { x: 120, y: 120 };
  const right = Math.max(...artboards.map((node) => node.x + node.width));
  return { x: right + 120, y: 120 };
}

function validNodeType(type: unknown): type is NodeType {
  return type === 'artboard' || type === 'frame' || type === 'text' || type === 'rectangle' || type === 'ellipse' || type === 'line' || type === 'arrow' || type === 'polygon' || type === 'image';
}

function validateStylePatch(style: Partial<NodeStyle> | undefined): Partial<NodeStyle> {
  if (!style) return {};
  const next: Partial<NodeStyle> = {};
  if (style.fill !== undefined) next.fill = safeColor(style.fill, 'fill');
  if (style.color !== undefined) next.color = safeColor(style.color, 'text color');
  if (style.borderColor !== undefined) next.borderColor = safeColor(style.borderColor, 'border color');
  if (style.opacity !== undefined) next.opacity = clamp(ensureFinite(style.opacity, 'opacity', 0, 1), 0, 1);
  if (style.borderWidth !== undefined) next.borderWidth = ensureFinite(style.borderWidth, 'border width', 0, 100);
  if (style.borderStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(style.borderStyle)) throw new CommandError('INVALID_STYLE', 'stroke style must be solid, dashed, or dotted.');
  if (style.borderStyle !== undefined) next.borderStyle = style.borderStyle;
  if (style.borderRadius !== undefined) next.borderRadius = ensureFinite(style.borderRadius, 'border radius', 0, MAX_NODE_DIMENSION);
  if (style.fontFamily !== undefined) next.fontFamily = ensureString(style.fontFamily, 'font family', 160);
  if (style.fontSize !== undefined) next.fontSize = ensureFinite(style.fontSize, 'font size', 1, 400);
  if (style.fontWeight !== undefined && ![400, 500, 600, 700].includes(style.fontWeight)) throw new CommandError('INVALID_STYLE', 'font weight must be 400, 500, 600, or 700.');
  if (style.fontWeight !== undefined) next.fontWeight = style.fontWeight;
  if (style.lineHeight !== undefined) next.lineHeight = ensureFinite(style.lineHeight, 'line height', 0.5, 4);
  if (style.letterSpacing !== undefined) next.letterSpacing = ensureFinite(style.letterSpacing, 'letter spacing', -40, 80);
  if (style.textAlign !== undefined && !['left', 'center', 'right'].includes(style.textAlign)) throw new CommandError('INVALID_STYLE', 'text alignment must be left, center, or right.');
  if (style.textAlign !== undefined) next.textAlign = style.textAlign;
  return next;
}

function validateShapePatch(shape: { sides?: number } | undefined): { sides?: number } {
  if (!shape) return {};
  const next: { sides?: number } = {};
  if (shape.sides !== undefined) next.sides = Math.round(ensureFinite(shape.sides, 'polygon sides', 3, 12));
  return next;
}

function validateLayoutPatch(layout: Partial<LayoutStyle> | undefined): Partial<LayoutStyle> {
  if (!layout) return {};
  const next: Partial<LayoutStyle> = {};
  if (layout.mode !== undefined && !['free', 'flex-row', 'flex-column'].includes(layout.mode)) throw new CommandError('INVALID_LAYOUT', 'layout mode is not supported.');
  if (layout.mode !== undefined) next.mode = layout.mode;
  if (layout.gap !== undefined) next.gap = ensureFinite(layout.gap, 'gap', 0, 1000);
  if (layout.padding !== undefined) next.padding = ensureFinite(layout.padding, 'padding', 0, 1000);
  if (layout.alignItems !== undefined && !['start', 'center', 'end', 'stretch'].includes(layout.alignItems)) throw new CommandError('INVALID_LAYOUT', 'align-items is not supported.');
  if (layout.alignItems !== undefined) next.alignItems = layout.alignItems;
  if (layout.justifyContent !== undefined && !['start', 'center', 'end', 'space-between'].includes(layout.justifyContent)) throw new CommandError('INVALID_LAYOUT', 'justify-content is not supported.');
  if (layout.justifyContent !== undefined) next.justifyContent = layout.justifyContent;
  if (layout.clipContent !== undefined) {
    if (typeof layout.clipContent !== 'boolean') throw new CommandError('INVALID_LAYOUT', 'clip-content must be boolean.');
    next.clipContent = layout.clipContent;
  }
  if (layout.wrap !== undefined) {
    if (typeof layout.wrap !== 'boolean') throw new CommandError('INVALID_LAYOUT', 'wrap must be boolean.');
    next.wrap = layout.wrap;
  }
  return next;
}

function validateSizingPatch(sizing: Partial<NodeSizing> | undefined): Partial<NodeSizing> {
  if (!sizing) return {};
  const next: Partial<NodeSizing> = {};
  if (sizing.width !== undefined) {
    if (!['fixed', 'hug', 'fill'].includes(sizing.width)) throw new CommandError('INVALID_SIZING', 'width sizing must be fixed, hug, or fill.');
    next.width = sizing.width;
  }
  if (sizing.height !== undefined) {
    if (!['fixed', 'hug', 'fill'].includes(sizing.height)) throw new CommandError('INVALID_SIZING', 'height sizing must be fixed, hug, or fill.');
    next.height = sizing.height;
  }
  return next;
}

function validateImageMetadata(document: DocumentModel, image: (Partial<ImageMetadata> & { assetId: string }) | undefined): ImageMetadata {
  if (!image || typeof image.assetId !== 'string') throw new CommandError('INVALID_IMAGE', 'An image element needs an assetId.');
  const asset = document.assets[image.assetId];
  if (!asset) throw new CommandError('ASSET_NOT_FOUND', `No image asset has the ID “${image.assetId}”.`, [image.assetId]);
  return {
    assetId: asset.id,
    originalName: typeof image.originalName === 'string' ? image.originalName.slice(0, 160) : asset.originalName,
    naturalWidth: asset.naturalWidth,
    naturalHeight: asset.naturalHeight,
    aspectRatio: asset.aspectRatio,
    role: image.role === 'content' ? 'content' : 'reference',
    label: typeof image.label === 'string' ? image.label.slice(0, 160) : asset.originalName,
    alt: typeof image.alt === 'string' ? image.alt.slice(0, 240) : asset.originalName,
    palette: asset.palette.slice(0, 6),
  };
}

function assetSummary(asset: ImageAsset): Record<string, unknown> {
  return { assetId: asset.id, name: asset.originalName, source: asset.sourceLabel ?? 'Uploaded', type: 'image', dimensions: { width: asset.naturalWidth, height: asset.naturalHeight } };
}

function upsertAsset(document: DocumentModel, input: ImageAsset): ImageAsset {
  if (!input.dataUrl.startsWith('data:image/')) throw new CommandError('UNSUPPORTED_IMAGE', 'Only supported image data can be added.');
  if (input.dataUrl.length > 1_500_000) throw new CommandError('IMAGE_TOO_LARGE', 'Image data must be smaller than 1.5 MB.');
  const existing = Object.values(document.assets).find((asset) => asset.dataUrl === input.dataUrl);
  if (existing) return existing;
  const asset = deepClone(input);
  asset.sourceLabel = asset.sourceLabel?.slice(0, 40) || 'Uploaded';
  asset.originalName = asset.originalName.slice(0, 160) || 'Image asset';
  asset.naturalWidth = Math.max(1, Math.round(asset.naturalWidth));
  asset.naturalHeight = Math.max(1, Math.round(asset.naturalHeight));
  asset.aspectRatio = asset.naturalWidth / asset.naturalHeight;
  document.assets[asset.id] = asset;
  return asset;
}

function placeAssetMutation(document: DocumentModel, input: PlaceAssetInput): MutationOutcome {
  const frame = assertNode(document, input.frameId);
  if (frame.type !== 'artboard' && frame.type !== 'frame') throw new CommandError('INVALID_TARGET', 'frameId must reference a Frame.', [frame.id]);
  if (isEffectivelyLocked(document, frame.id)) return noOpOutcome(document, 'The target Frame is locked.', [frame.id]);
  const asset = input.asset ? upsertAsset(document, input.asset) : input.assetId ? document.assets[input.assetId] : undefined;
  if (!asset) throw new CommandError('ASSET_NOT_FOUND', 'Provide an existing assetId or image data to place.', [input.assetId ?? '']);
  const ratio = asset.aspectRatio > 0 ? asset.aspectRatio : asset.naturalWidth / Math.max(1, asset.naturalHeight);
  let width = input.width ?? Math.min(360, Math.max(140, asset.naturalWidth));
  let height = input.height ?? width / ratio;
  if (input.width !== undefined && input.height === undefined) height = width / ratio;
  if (input.height !== undefined && input.width === undefined) width = height * ratio;
  width = ensureDimension(width, 'width');
  height = ensureDimension(height, 'height');
  const node = makeNode({
    id: createId('image'),
    type: 'image',
    name: input.name ? ensureString(input.name, 'layer name') : asset.originalName || 'Image layer',
    pageId: frame.pageId,
    parentId: frame.id,
    x: ensureFinite(input.position.x, 'x'),
    y: ensureFinite(input.position.y, 'y'),
    width,
    height,
    style: { borderRadius: 12, borderWidth: 0 },
    image: {
      assetId: asset.id,
      originalName: asset.originalName,
      naturalWidth: asset.naturalWidth,
      naturalHeight: asset.naturalHeight,
      aspectRatio: asset.aspectRatio,
      role: 'content',
      label: asset.originalName,
      alt: input.alt?.slice(0, 240) || asset.originalName,
      palette: asset.palette.slice(0, 6),
    },
  });
  document.nodes[node.id] = node;
  frame.childIds.push(node.id);
  document.selection = { ids: [node.id], primaryId: node.id };
  const bounds = { x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation };
  return { document, changedIds: [asset.id, node.id], skippedIds: [], result: { assetId: asset.id, layerId: node.id, layerName: node.name, frame: { id: frame.id, name: frame.name, type: 'frame' }, bounds, source: asset.sourceLabel ?? 'Uploaded' }, message: `Added image to ${frame.name}` };
}

function createElementFromSpec(document: DocumentModel, pageId: string, parentId: string | null, spec: ElementSpec, index: number): DesignNode {
  if (!validNodeType(spec.type) || spec.type === 'artboard') throw new CommandError('INVALID_ELEMENT', 'Element type must be frame, text, rectangle, ellipse, line, arrow, polygon, or image inside a frame.');
  if (spec.type === 'text' && typeof spec.content !== 'string') throw new CommandError('INVALID_ELEMENT', 'Text elements need content.');
  if (spec.content !== undefined && spec.content.length > MAX_TEXT_LENGTH) throw new CommandError('INVALID_ELEMENT', `Text content must be at most ${MAX_TEXT_LENGTH} characters.`);
  const sizing = validateSizingPatch(spec.sizing);
  const node = makeNode({
    id: createId(spec.type),
    type: spec.type,
    name: spec.name ? ensureString(spec.name, 'element name') : `${spec.type} ${index + 1}`,
    pageId,
    parentId,
    x: ensureFinite(spec.x ?? (parentId ? 32 : 120), 'x'),
    y: ensureFinite(spec.y ?? (parentId ? 32 : 120), 'y'),
    width: ensureDimension(spec.width, 'width'),
    height: ensureDimension(spec.height, 'height'),
    rotation: ensureFinite(spec.rotation ?? 0, 'rotation', -360, 360),
    sizing: spec.sizing ? { width: sizing.width ?? 'fixed', height: sizing.height ?? 'fixed' } : undefined,
    style: { ...defaultNodeStyle(spec.type), ...validateStylePatch(spec.style) },
    layout: spec.type === 'frame' ? { ...defaultLayout(), ...validateLayoutPatch(spec.layout) } : undefined,
    shape: spec.shape ? validateShapePatch(spec.shape) : undefined,
    content: spec.content,
    hidden: spec.hidden ?? false,
    locked: spec.locked ?? false,
    image: spec.type === 'image' ? validateImageMetadata(document, spec.image) : undefined,
    binding: spec.binding ? {
      key: ensureString(spec.binding.key, 'binding key', 80),
      sourceLabel: spec.binding.sourceLabel ? ensureString(spec.binding.sourceLabel, 'source label', 120) : undefined,
      lastUpdatedAt: nowIso(),
      sharedValue: typeof spec.binding.sharedValue === 'string' ? spec.binding.sharedValue.slice(0, MAX_TEXT_LENGTH) : undefined,
    } : undefined,
  });
  document.nodes[node.id] = node;
  const parent = parentId ? document.nodes[parentId] : undefined;
  const page = assertPage(document, pageId);
  if (parent) parent.childIds.push(node.id);
  else page.rootIds.push(node.id);
  const children = spec.children ?? [];
  if (children.length > 100) throw new CommandError('TOO_MANY_NODES', 'An element tree may contain at most 100 nodes.');
  children.forEach((child, childIndex) => createElementFromSpec(document, pageId, node.id, child, childIndex));
  return node;
}

function countSpecs(elements: ElementSpec[], count = 0): number {
  return elements.reduce((total, element) => total + 1 + countSpecs(element.children ?? []), count);
}

function absoluteParentPosition(document: DocumentModel, parentId: string | null): Point {
  return parentId ? getAbsolutePosition(document, parentId) : { x: 0, y: 0 };
}

function patchNode(document: DocumentModel, node: DesignNode, patch: ElementPatch): void {
  if (patch.name !== undefined) node.name = ensureString(patch.name, 'name');
  if (patch.x !== undefined) node.x = ensureFinite(patch.x, 'x');
  if (patch.y !== undefined) node.y = ensureFinite(patch.y, 'y');
  if (patch.width !== undefined) node.width = ensureDimension(patch.width, 'width');
  if (patch.height !== undefined) node.height = ensureDimension(patch.height, 'height');
  if (patch.rotation !== undefined) node.rotation = ensureFinite(patch.rotation, 'rotation', -360, 360);
  if (patch.sizing !== undefined) {
    const sizing = validateSizingPatch(patch.sizing);
    node.sizing = { width: sizing.width ?? node.sizing?.width ?? 'fixed', height: sizing.height ?? node.sizing?.height ?? 'fixed' };
  }
  if (patch.content !== undefined) {
    if (node.type !== 'text') throw new CommandError('INVALID_ELEMENT', `Only text elements accept content.`, [node.id]);
    if (patch.content.length > MAX_TEXT_LENGTH) throw new CommandError('INVALID_ELEMENT', `Text content must be at most ${MAX_TEXT_LENGTH} characters.`, [node.id]);
    node.content = patch.content;
  }
  if (patch.style !== undefined) node.style = { ...node.style, ...validateStylePatch(patch.style) };
  if (patch.shape !== undefined) {
    if (node.type !== 'polygon') throw new CommandError('INVALID_SHAPE', 'Only polygon layers accept shape properties.', [node.id]);
    node.shape = { ...(node.shape ?? {}), ...validateShapePatch(patch.shape) };
  }
  if (patch.layout !== undefined) {
    if (node.type !== 'frame' && node.type !== 'artboard') throw new CommandError('INVALID_LAYOUT', 'Only Frames accept layout settings.', [node.id]);
    node.layout = { ...defaultLayout(), ...(node.layout ?? {}), ...validateLayoutPatch(patch.layout) };
  }
  if (patch.image !== undefined) {
    if (node.type !== 'image') throw new CommandError('INVALID_IMAGE', 'Only image elements accept image metadata.', [node.id]);
    const assetId = patch.image.assetId ?? node.image?.assetId;
    if (!assetId) throw new CommandError('INVALID_IMAGE', 'An image update needs an assetId.', [node.id]);
    node.image = validateImageMetadata(document, { ...(node.image ?? {}), ...patch.image, assetId });
  }
  if (patch.hidden !== undefined) {
    if (typeof patch.hidden !== 'boolean') throw new CommandError('INVALID_INPUT', 'hidden must be boolean.', [node.id]);
    node.hidden = patch.hidden;
  }
  if (patch.locked !== undefined) {
    if (typeof patch.locked !== 'boolean') throw new CommandError('INVALID_INPUT', 'locked must be boolean.', [node.id]);
    node.locked = patch.locked;
  }
  setNodeUpdated(node);
}

function moveNodeToParent(document: DocumentModel, node: DesignNode, newParentId: string | null): void {
  if (newParentId === node.id || (newParentId && isDescendant(document, newParentId, node.id))) throw new CommandError('INVALID_HIERARCHY', 'An element cannot become its own descendant.', [node.id]);
  if (node.type === 'artboard' && newParentId !== null) throw new CommandError('INVALID_HIERARCHY', 'Frames must remain at the Canvas root.', [node.id]);
  if (newParentId) {
    const parent = assertNode(document, newParentId);
    if (parent.pageId !== node.pageId || (parent.type !== 'frame' && parent.type !== 'artboard')) throw new CommandError('INVALID_HIERARCHY', 'Layers can only move into a Frame on the same Canvas.', [node.id, newParentId]);
  }
  const oldParent = node.parentId ? document.nodes[node.parentId] : undefined;
  const oldPage = getPage(document, node.pageId);
  if (oldParent) oldParent.childIds = removeFromArray(oldParent.childIds, node.id);
  else if (oldPage) oldPage.rootIds = removeFromArray(oldPage.rootIds, node.id);
  node.parentId = newParentId;
  if (newParentId) document.nodes[newParentId].childIds.push(node.id);
  else assertPage(document, node.pageId).rootIds.push(node.id);
}

function cloneSubtree(document: DocumentModel, sourceId: string, offset: Point, mapping: Record<string, string>): string {
  const source = assertNode(document, sourceId);
  const newId = createId(source.type);
  mapping[source.id] = newId;
  const clone = deepClone(source);
  clone.id = newId;
  clone.name = `${source.name} copy`;
  clone.annotations = clone.annotations?.map((annotation) => ({ ...annotation, id: createId('annotation') }));
  clone.x += offset.x;
  clone.y += offset.y;
  clone.childIds = [];
  clone.updatedAt = nowIso();
  document.nodes[newId] = clone;
  const parent = source.parentId ? document.nodes[source.parentId] : undefined;
  const page = assertPage(document, source.pageId);
  if (source.parentId && parent) parent.childIds = insertAfter(parent.childIds, source.id, newId);
  else page.rootIds = insertAfter(page.rootIds, source.id, newId);
  source.childIds.forEach((childId) => {
    const childNewId = cloneSubtree(document, childId, { x: 0, y: 0 }, mapping);
    document.nodes[childNewId].parentId = newId;
    clone.childIds.push(childNewId);
    const originalChild = document.nodes[childId];
    if (originalChild) {
      const parentChildren = document.nodes[originalChild.parentId ?? '']?.childIds;
      if (parentChildren) parentChildren.splice(parentChildren.indexOf(childNewId), 1);
    }
  });
  return newId;
}

function effectiveSelection(document: DocumentModel, ids: string[]): string[] {
  const unique = uniqueIds(ids).filter((id) => Boolean(document.nodes[id]));
  return unique.filter((id) => !unique.some((candidate) => candidate !== id && isDescendant(document, id, candidate)));
}

function withSelection(state: EditorState, ids: string[], additive = false): EditorState {
  const valid = uniqueIds(ids).filter((id) => Boolean(state.document.nodes[id]));
  const nextIds = additive ? uniqueIds([...state.document.selection.ids, ...valid]) : valid;
  return {
    ...state,
    document: {
      ...state.document,
      selection: { ids: nextIds, primaryId: nextIds[nextIds.length - 1] ?? null },
    },
  };
}

function updateSelectionAfterDeletion(document: DocumentModel): void {
  const ids = document.selection.ids.filter((id) => Boolean(document.nodes[id]));
  document.selection = { ids, primaryId: ids.includes(document.selection.primaryId ?? '') ? document.selection.primaryId : ids[ids.length - 1] ?? null };
}

function historyChangedIds(before: DocumentModel, after: DocumentModel): string[] {
  const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
  return [...ids].filter((id) => JSON.stringify(before.nodes[id] ?? null) !== JSON.stringify(after.nodes[id] ?? null)).slice(0, 50);
}

function dispatchHistory(state: EditorState, request: HistoryRequest, source: ActionSource): EditorState {
  if (!request || !['undo', 'redo'].includes(request.action) || !Number.isInteger(request.steps) || request.steps < 1 || request.steps > 20) {
    throw new CommandError('INVALID_HISTORY', 'history.steps must be a positive integer between 1 and 20, and action must be undo or redo.');
  }
  let current = state;
  let applied = 0;
  const before = state.document;
  while (applied < request.steps) {
    if (request.action === 'undo') {
      const entry = current.history[current.history.length - 1];
      if (!entry) break;
      const snapshot = makeSnapshotState(current);
      const restored = restoreSnapshot(current, entry);
      current = { ...restored, history: current.history.slice(0, -1), future: [{ ...snapshot, label: entry.label }, ...current.future], lastAction: null };
    } else {
      const entry = current.future[0];
      if (!entry) break;
      const snapshot = makeSnapshotState(current);
      const restored = restoreSnapshot(current, entry);
      current = { ...restored, history: [...current.history, { ...snapshot, label: entry.label }], future: current.future.slice(1), lastAction: null };
    }
    applied += 1;
  }
  if (!applied) throw new CommandError('HISTORY_EMPTY', `No ${request.action} history is available for the active File.`);
  const available = { undo: current.history.length, redo: current.future.length };
  current.lastAction = {
    id: createId('action'),
    label: `${request.action === 'undo' ? 'Undid' : 'Redid'} ${applied} change${applied === 1 ? '' : 's'}`,
    source,
    changedIds: historyChangedIds(before, current.document),
    skippedIds: [],
    failedIds: [],
    result: { history: { action: request.action, steps: applied, availableUndo: available.undo, availableRedo: available.redo } },
    at: Date.now(),
  };
  return current;
}

export function dispatchCommand(state: EditorState, command: Command): EditorState {
  switch (command.type) {
      case 'set-selection':
        return withSelection(state, command.ids, command.additive);
      case 'set-viewport':
        return { ...state, document: { ...state.document, viewport: clampViewport(command.viewport) } };
      case 'set-theme':
        return { ...state, theme: command.theme };
      case 'undo': {
        const entry = state.history[state.history.length - 1];
        if (!entry) return state;
        const current = makeSnapshotState(state);
        const restored = restoreSnapshot(state, entry);
        return { ...restored, history: state.history.slice(0, -1), future: [{ ...current, label: entry.label }, ...state.future], lastAction: null };
      }
      case 'redo': {
        const entry = state.future[0];
        if (!entry) return state;
        const current = makeSnapshotState(state);
        const restored = restoreSnapshot(state, entry);
        return { ...restored, history: [...state.history, { ...current, label: entry.label }], future: state.future.slice(1), lastAction: null };
      }
      case 'set-document-name':
        return makeMutation(state, 'Renamed File', command.source ?? 'human', (document) => {
          const name = ensureString(command.name, 'File name');
          if (document.name === name) return noOpOutcome(document, 'File name is unchanged.');
          document.name = name;
          return { document, changedIds: [], skippedIds: [], message: `Renamed File to ${name}` };
        });
      case 'create-page': {
        const pageId = createId('page');
        return makeMutation(state, 'Created Canvas', command.source ?? 'human', (document) => {
          let name = command.name ? ensureString(command.name, 'Canvas name') : `Canvas ${document.pages.length + 1}`;
          let suffix = 2;
          while (document.pages.some((page) => page.name.toLowerCase() === name.toLowerCase())) name = `${name} ${suffix++}`;
          document.pages.push({ id: pageId, name, rootIds: [] });
          document.activePageId = pageId;
          document.selection = { ids: [], primaryId: null };
          return { document, changedIds: [pageId], skippedIds: [], message: `Created ${name}` };
        });
      }
      case 'rename-page':
        return makeMutation(state, 'Renamed Canvas', command.source ?? 'human', (document) => {
          const page = assertPage(document, command.pageId);
          const name = ensureString(command.name, 'Canvas name');
          if (document.pages.some((candidate) => candidate.id !== page.id && candidate.name.toLowerCase() === name.toLowerCase())) throw new CommandError('DUPLICATE_NAME', `A Canvas named “${name}” already exists.`, [page.id]);
          page.name = name;
          return { document, changedIds: [page.id], skippedIds: [], message: `Renamed Canvas to ${name}` };
        });
      case 'delete-page':
        return makeMutation(state, 'Deleted Canvas', command.source ?? 'human', (document) => {
          if (document.pages.length <= 1) throw new CommandError('LAST_CANVAS', 'Keep at least one Canvas in the File.');
          const page = assertPage(document, command.pageId);
          const deletedIds = page.rootIds.flatMap((id) => deleteSubtree(document, id));
          document.pages = document.pages.filter((candidate) => candidate.id !== page.id);
          if (document.activePageId === page.id) document.activePageId = document.pages[0].id;
          updateSelectionAfterDeletion(document);
          return { document, changedIds: [page.id, ...deletedIds], skippedIds: [], message: `Deleted ${page.name}` };
        });
      case 'create-artboard': {
        const nodeId = createId('artboard');
        return makeMutation(state, 'Created Frame', command.source ?? 'human', (document) => {
          const page = assertPage(document, document.activePageId);
          const name = ensureString(command.name, 'Frame name');
          const preset = command.preset ? ensurePreset(command.preset) : undefined;
           if (command.preset && !preset) throw new CommandError('INVALID_PRESET', `Unsupported frame preset “${command.preset}”.`);
          const size = preset ?? { width: ensureDimension(command.width, 'width'), height: ensureDimension(command.height, 'height') };
          const position = command.position ?? nextPlacement(document, page.id);
          const node = makeNode({ id: nodeId, type: 'artboard', name, pageId: page.id, parentId: null, x: ensureFinite(position.x, 'x'), y: ensureFinite(position.y, 'y'), width: size.width, height: size.height, style: { fill: '#ffffff' } });
          document.nodes[node.id] = node;
          page.rootIds.push(node.id);
          document.selection = { ids: [node.id], primaryId: node.id };
          return { document, changedIds: [node.id], skippedIds: [], result: { createdIds: [node.id], frameId: node.id, frame: { id: node.id, name: node.name, type: 'frame', width: node.width, height: node.height } }, message: `Created Frame ${name}` };
        });
      }
      case 'insert-elements':
        return makeMutation(state, 'Inserted elements', command.source ?? 'human', (document) => insertElementsMutation(document, command));
      case 'write-artboard':
        return makeMutation(state, 'Wrote frame', command.source ?? 'agent', (document) => writeArtboardMutation(document, command));
      case 'update-elements':
        return 'history' in command && command.history
          ? dispatchHistory(state, command.history, command.source ?? 'human')
          : makeMutation(state, 'Updated elements', command.source ?? 'human', (document) => updateElementsMutation(document, command));
      case 'duplicate-elements':
        return makeMutation(state, 'Duplicated elements', command.source ?? 'human', (document) => duplicateMutation(document, command));
      case 'delete-elements':
        return makeMutation(state, 'Deleted elements', command.source ?? 'human', (document) => deleteMutation(document, command));
      case 'rename-node':
        return makeMutation(state, 'Renamed element', command.source ?? 'human', (document) => {
          const node = assertNode(document, command.id);
          if (isEffectivelyLocked(document, node.id)) return noOpOutcome(document, 'Locked elements were skipped.', [node.id]);
          node.name = ensureString(command.name, 'Element name');
          setNodeUpdated(node);
          return { document, changedIds: [node.id], skippedIds: [], message: `Renamed ${node.name}` };
        });
      case 'toggle-hidden':
        return makeMutation(state, 'Changed visibility', command.source ?? 'human', (document) => toggleNodeProperty(document, command.ids, 'hidden', command.hidden, false));
      case 'toggle-locked':
        return makeMutation(state, 'Changed locks', command.source ?? 'human', (document) => toggleNodeProperty(document, command.ids, 'locked', command.locked, true));
      case 'add-annotation':
        return makeMutation(state, 'Added annotation', command.source ?? 'human', (document) => addAnnotationMutation(document, command.nodeId, command.text));
      case 'update-annotation':
        return makeMutation(state, 'Updated annotation', command.source ?? 'human', (document) => updateAnnotationMutation(document, command.nodeId, command.annotationId, command.text, command.resolved));
      case 'delete-annotation':
        return makeMutation(state, 'Deleted annotation', command.source ?? 'human', (document) => deleteAnnotationMutation(document, command.nodeId, command.annotationId));
      case 'reorder-elements':
        return makeMutation(state, 'Reordered elements', command.source ?? 'human', (document) => reorderMutation(document, command.ids, command.direction));
      case 'reorder-layer':
        return makeMutation(state, 'Reordered layer', command.source ?? 'human', (document) => reorderLayerMutation(document, command));
      case 'align-elements':
        return makeMutation(state, 'Aligned elements', command.source ?? 'human', (document) => alignMutation(document, command.ids, command.alignment));
      case 'distribute-elements':
        return makeMutation(state, 'Distributed elements', command.source ?? 'human', (document) => distributeMutation(document, command.ids, command.axis));
      case 'group-elements':
        return makeMutation(state, 'Grouped elements', command.source ?? 'human', (document) => groupMutation(document, command.ids));
      case 'ungroup-elements':
        return makeMutation(state, 'Ungrouped elements', command.source ?? 'human', (document) => ungroupMutation(document, command.ids));
      case 'bind-context':
        return makeMutation(state, 'Bound context fields', command.source ?? 'agent', (document) => bindMutation(document, command.bindings));
      case 'apply-context':
        return makeMutation(state, 'Applied context values', command.source ?? 'agent', (document) => applyContextMutation(document, command.values, command.force ?? false));
      case 'unbind-context':
        return makeMutation(state, 'Unbound context fields', command.source ?? 'human', (document) => {
          const changedIds: string[] = [];
          const skippedIds: string[] = [];
          uniqueIds(command.ids).forEach((id) => {
            const node = document.nodes[id];
            if (!node?.binding) return;
            if (isEffectivelyLocked(document, node.id)) {
              skippedIds.push(node.id);
              return;
            }
            delete node.binding;
            setNodeUpdated(node);
            changedIds.push(node.id);
          });
          return { document, changedIds, skippedIds, message: `Unbound ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
        });
      case 'insert-image-asset':
        return makeMutation(state, 'Inserted reference image', command.source ?? 'human', (document) => {
          const asset = upsertAsset(document, command.asset);
          const page = assertPage(document, document.activePageId);
          const node = makeNode({
            id: createId('image'),
            type: 'image',
            name: asset.originalName || 'Image layer',
            pageId: page.id,
            parentId: null,
            x: ensureFinite(command.position.x, 'x'),
            y: ensureFinite(command.position.y, 'y'),
            width: Math.min(420, Math.max(160, asset.naturalWidth)),
            height: Math.min(320, Math.max(120, asset.naturalHeight)),
            image: {
              assetId: asset.id,
              originalName: asset.originalName,
              naturalWidth: asset.naturalWidth,
              naturalHeight: asset.naturalHeight,
              aspectRatio: asset.aspectRatio,
              role: 'content',
              label: asset.originalName || 'Image layer',
              alt: asset.originalName || 'Image layer',
              palette: asset.palette.slice(0, 6),
            },
          });
          document.nodes[node.id] = node;
          page.rootIds.push(node.id);
          document.selection = { ids: [node.id], primaryId: node.id };
          return { document, changedIds: [node.id, asset.id], skippedIds: [], result: { assetId: asset.id, layerId: node.id, layerName: node.name, frame: null, bounds: { x: node.x, y: node.y, width: node.width, height: node.height } }, message: 'Added image to Canvas' };
        });
      case 'import-asset':
        return makeMutation(state, 'Added asset', command.source ?? 'human', (document) => {
          const asset = upsertAsset(document, command.asset);
          return { document, changedIds: [asset.id], skippedIds: [], result: { assetId: asset.id, asset: assetSummary(asset), deduplicated: asset.id !== command.asset.id }, message: `Added ${asset.originalName || 'asset'}` };
        });
      case 'place-asset':
        return makeMutation(state, 'Added image', command.source ?? 'human', (document) => placeAssetMutation(document, command));
    default:
      return state;
  }
}

export function tryDispatchCommand(state: EditorState, command: Command): { state: EditorState; error?: CommandError } {
  try {
    return { state: dispatchCommand(state, command) };
  } catch (error) {
    if (error instanceof CommandError) return { state, error };
    return { state, error: new CommandError('UNKNOWN_ERROR', 'The action could not be completed.') };
  }
}

function insertElementsMutation(document: DocumentModel, input: InsertElementsInput): MutationOutcome {
  const targets = [input.pageId, input.artboardId, input.frameId, input.parentId].filter(Boolean);
  if (targets.length !== 1) throw new CommandError('AMBIGUOUS_TARGET', 'Provide exactly one of pageId, frameId, or parentId.');
  if (!input.elements.length || countSpecs(input.elements) > 100) throw new CommandError('TOO_MANY_NODES', 'Insert between 1 and 100 total nodes.');
  let pageId: string;
  let parentId: string | null = null;
  if (input.pageId) {
    pageId = assertPage(document, input.pageId).id;
  } else if (input.artboardId) {
    const artboard = assertArtboard(document, input.artboardId);
    pageId = artboard.pageId;
    parentId = artboard.id;
    if (isEffectivelyLocked(document, artboard.id)) return noOpOutcome(document, 'The target Frame is locked.', [artboard.id]);
  } else if (input.frameId) {
    const frame = assertNode(document, input.frameId);
    if (frame.type !== 'artboard' && frame.type !== 'frame') throw new CommandError('INVALID_TARGET', 'frameId must reference a Frame.', [frame.id]);
    pageId = frame.pageId;
    parentId = frame.id;
    if (isEffectivelyLocked(document, frame.id)) return noOpOutcome(document, 'The target Frame is locked.', [frame.id]);
  } else {
    const parent = assertNode(document, input.parentId as string);
    if (parent.type !== 'frame' && parent.type !== 'artboard') throw new CommandError('INVALID_TARGET', 'parentId must reference a Frame.', [parent.id]);
    pageId = parent.pageId;
    parentId = parent.id;
    if (isEffectivelyLocked(document, parent.id)) return noOpOutcome(document, 'The target parent is locked.', [parent.id]);
  }
  const changedIds: string[] = [];
  const createdIds: string[] = [];
  input.elements.forEach((spec, index) => {
    const node = createElementFromSpec(document, pageId, parentId, spec, index);
    const ids = getDescendantIds(document, node.id);
    changedIds.push(...ids);
    createdIds.push(...ids);
  });
  document.selection = { ids: changedIds.filter((id) => document.nodes[id].parentId === parentId), primaryId: changedIds[changedIds.length - 1] ?? null };
  return { document, changedIds, skippedIds: [], result: { createdIds }, message: `Added ${changedIds.length} layer${changedIds.length === 1 ? '' : 's'}` };
}

function writeArtboardMutation(document: DocumentModel, input: WriteArtboardInput): MutationOutcome {
  const artboard = assertArtboard(document, input.artboardId);
  if (isEffectivelyLocked(document, artboard.id) && !input.force) return noOpOutcome(document, 'The target Frame is locked.', [artboard.id]);
  if (!input.elements.length || countSpecs(input.elements) > 100) throw new CommandError('TOO_MANY_NODES', 'Write between 1 and 100 total nodes.');
  const descendants = artboard.childIds.flatMap((id) => getDescendantIds(document, id));
  const locked = descendants.filter((id) => isEffectivelyLocked(document, id));
  if (input.mode === 'replace' && locked.length && !input.force) throw new CommandError('LOCKED_NODE', 'Replace would remove locked content. Retry with force: true after deliberate review.', locked);
  const changedIds: string[] = [];
  const createdIds: string[] = [];
  if (input.mode === 'replace') {
    [...artboard.childIds].forEach((id) => changedIds.push(...deleteSubtree(document, id)));
    artboard.childIds = [];
  }
  input.elements.forEach((spec, index) => {
    const node = createElementFromSpec(document, artboard.pageId, artboard.id, spec, index);
    const ids = getDescendantIds(document, node.id);
    changedIds.push(...ids);
    createdIds.push(...ids);
  });
  document.selection = { ids: artboard.childIds.slice(), primaryId: artboard.childIds[artboard.childIds.length - 1] ?? artboard.id };
  return { document, changedIds, skippedIds: [], result: { createdIds }, message: `${input.mode === 'replace' ? 'Replaced' : 'Appended'} ${artboard.name}` };
}

function changedValueRecord(node: DesignNode, patches: ElementPatch[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const has = (key: string): boolean => patches.some((patch) => Object.prototype.hasOwnProperty.call(patch, key));
  if (has('name')) values.name = node.name;
  if (has('x')) values.x = node.x;
  if (has('y')) values.y = node.y;
  if (has('width')) values.width = node.width;
  if (has('height')) values.height = node.height;
  if (has('rotation')) values.rotation = node.rotation;
  if (has('sizing')) values.sizing = node.sizing ? deepClone(node.sizing) : undefined;
  if (has('content')) values.content = node.content;
  if (has('parentId')) values.parentId = node.parentId;
  if (has('hidden')) values.hidden = node.hidden;
  if (has('locked')) values.locked = node.locked;
  if (has('shape')) values.shape = node.shape ? deepClone(node.shape) : undefined;
  const styleKeys = [...new Set(patches.flatMap((patch) => Object.entries(patch.style ?? {}).filter(([, value]) => value !== undefined).map(([key]) => key)))];
  if (styleKeys.length) values.style = Object.fromEntries(styleKeys.map((key) => [key, node.style[key as keyof NodeStyle]]));
  const layoutKeys = [...new Set(patches.flatMap((patch) => Object.entries(patch.layout ?? {}).filter(([, value]) => value !== undefined).map(([key]) => key)))];
  if (layoutKeys.length) values.layout = Object.fromEntries(layoutKeys.map((key) => [key, node.layout?.[key as keyof LayoutStyle]]));
  if (has('image')) values.image = node.image ? { assetId: node.image.assetId, role: node.image.role, label: node.image.label, alt: node.image.alt } : null;
  return values;
}

function changedNodeRecord(document: DocumentModel, node: DesignNode, patches: ElementPatch[]): Record<string, unknown> {
  const artboard = getArtboardForNode(document, node.id);
  const rect = getAbsoluteRect(document, node.id);
  return { id: node.id, name: node.name, type: node.type === 'artboard' ? 'frame' : node.type, frame: artboard ? { id: artboard.id, name: artboard.name } : null, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: rect.rotation }, values: changedValueRecord(node, patches) };
}

export function resolveSelectionTarget(document: DocumentModel): string {
  const ids = document.selection.ids.filter((id) => Boolean(document.nodes[id]));
  if (!ids.length) throw new CommandError('SELECTION_EMPTY', 'The current selection is empty. Select one Layer or provide an explicit id.', []);
  if (ids.length > 1) {
    const candidates = ids.slice(0, 8).map((id) => ({ id, name: document.nodes[id]?.name, type: document.nodes[id]?.type }));
    throw new CommandError('SELECTION_AMBIGUOUS', 'The current selection contains multiple Layers. Use explicit ids for a batch update.', ids, { candidates });
  }
  return ids[0];
}

function updateElementsMutation(document: DocumentModel, input: UpdateElementsInput): MutationOutcome {
  const updates = 'updates' in input ? input.updates : undefined;
  if (!updates || !updates.length || updates.length > 50) throw new CommandError('TOO_MANY_UPDATES', 'Provide between 1 and 50 element updates.');
  const changedIds: string[] = [];
  const skippedIds: string[] = [];
  const failedIds: string[] = [];
  const resolvedUpdates = updates.map((patch) => {
    const id = patch.id ?? (patch.target.selection ? resolveSelectionTarget(document) : resolveSemanticTarget(document, patch.target));
    return { id, patch };
  });
  const patchesById = new Map<string, ElementPatch[]>();
  resolvedUpdates.forEach(({ id, patch }) => patchesById.set(id, [...(patchesById.get(id) ?? []), patch]));
  resolvedUpdates.forEach(({ id, patch }) => {
    const node = document.nodes[id];
    if (!node) {
      failedIds.push(id);
      return;
    }
    if (isEffectivelyLocked(document, node.id) && !input.force) {
      skippedIds.push(node.id);
      return;
    }
    const backup = deepClone(node);
    try {
      patchNode(document, node, { ...patch, id } as ElementPatch & { id: string });
      if (patch.parentId !== undefined) moveNodeToParent(document, node, patch.parentId);
      changedIds.push(node.id);
    } catch {
      document.nodes[id] = backup;
      failedIds.push(node.id);
    }
  });
  changedIds.push(...materializeDocumentLayout(document));
  const uniqueChangedIds = uniqueIds(changedIds);
  const changed = uniqueChangedIds.map((id) => changedNodeRecord(document, document.nodes[id], patchesById.get(id) ?? []));
  const result = { changed, changedCount: uniqueChangedIds.length };
  if (!uniqueChangedIds.length && failedIds.length) return { document, changedIds: uniqueChangedIds, skippedIds, failedIds, result, message: 'No requested updates could be applied.' };
  return { document, changedIds: uniqueChangedIds, skippedIds, failedIds, result, message: `Updated ${uniqueChangedIds.length} layer${uniqueChangedIds.length === 1 ? '' : 's'}` };
}

function duplicateMutation(document: DocumentModel, input: DuplicateInput): MutationOutcome {
  const ids = effectiveSelection(document, input.ids);
  if (!ids.length || ids.length > 20) throw new CommandError('INVALID_SELECTION', 'Duplicate between 1 and 20 existing element IDs.');
  const skippedIds = ids.filter((id) => {
    if (isEffectivelyLocked(document, id) && !input.force) return true;
    return !input.force && getDescendantIds(document, id).some((descendantId) => isEffectivelyLocked(document, descendantId));
  });
  const mapping: Record<string, string> = {};
  const changedIds: string[] = [];
  const offset = input.offset ?? { x: 32, y: 32 };
  ids.filter((id) => !skippedIds.includes(id)).forEach((id) => {
    const root = cloneSubtree(document, id, offset, mapping);
    changedIds.push(...getDescendantIds(document, root));
  });
  document.selection = { ids: changedIds.filter((id) => !document.nodes[id].parentId || !changedIds.includes(document.nodes[id].parentId)), primaryId: changedIds[changedIds.length - 1] ?? null };
  return { document, changedIds, skippedIds, result: { createdIds: [...changedIds], mappings: mapping }, message: `Duplicated ${changedIds.length} layer${changedIds.length === 1 ? '' : 's'}` };
}

function deleteMutation(document: DocumentModel, input: DeleteInput): MutationOutcome {
  const ids = effectiveSelection(document, input.ids);
  if (!ids.length || ids.length > 20) throw new CommandError('INVALID_SELECTION', 'Delete between 1 and 20 existing element IDs.');
  const skippedIds = ids.filter((id) => isEffectivelyLocked(document, id) && !input.force);
  const changedIds: string[] = [];
  ids.filter((id) => !skippedIds.includes(id)).forEach((id) => changedIds.push(...deleteSubtree(document, id)));
  updateSelectionAfterDeletion(document);
  return { document, changedIds, skippedIds, result: { deletedIds: [...changedIds] }, message: `Deleted ${changedIds.length} layer${changedIds.length === 1 ? '' : 's'}` };
}

function toggleNodeProperty(document: DocumentModel, ids: string[], property: 'hidden' | 'locked', value: boolean | undefined, allowLocked: boolean): MutationOutcome {
  const changedIds: string[] = [];
  const skippedIds: string[] = [];
  uniqueIds(ids).forEach((id) => {
    const node = document.nodes[id];
    if (!node) return;
    if (property === 'hidden' && isEffectivelyLocked(document, id)) {
      skippedIds.push(id);
      return;
    }
    if (property === 'locked' && !allowLocked && isEffectivelyLocked(document, id)) {
      skippedIds.push(id);
      return;
    }
    const nextValue = value ?? !node[property];
    if (node[property] !== nextValue) {
      node[property] = nextValue;
      setNodeUpdated(node);
      changedIds.push(id);
    }
  });
  return { document, changedIds, skippedIds, message: `Changed ${changedIds.length} layer${changedIds.length === 1 ? '' : 's'}` };
}

function annotationText(value: unknown): string {
  if (typeof value !== 'string') throw new CommandError('INVALID_INPUT', 'Annotation text must be a string.');
  if (value.length > MAX_TEXT_LENGTH) throw new CommandError('INVALID_INPUT', `Annotation text must be at most ${MAX_TEXT_LENGTH} characters.`);
  return value;
}

function addAnnotationMutation(document: DocumentModel, nodeId: string, text: string): MutationOutcome {
  const node = assertNode(document, nodeId);
  const annotation: LayerAnnotation = { id: createId('annotation'), text: annotationText(text), resolved: false };
  node.annotations = [...(node.annotations ?? []), annotation];
  setNodeUpdated(node);
  return { document, changedIds: [node.id], skippedIds: [], result: { annotation: { ...annotation, nodeId: node.id }, bounds: getAbsoluteRect(document, node.id) }, message: `Added annotation to ${node.name}` };
}

function updateAnnotationMutation(document: DocumentModel, nodeId: string, annotationId: string, text: string | undefined, resolved: boolean | undefined): MutationOutcome {
  const node = assertNode(document, nodeId);
  if (text === undefined && resolved === undefined) throw new CommandError('INVALID_INPUT', 'Provide text or resolved when updating an annotation.', [annotationId]);
  const annotations = node.annotations ?? [];
  const annotation = annotations.find((candidate) => candidate.id === annotationId);
  if (!annotation) throw new CommandError('ANNOTATION_NOT_FOUND', `No annotation with the ID “${annotationId}” exists on ${node.name}.`, [node.id, annotationId]);
  if (text !== undefined) annotation.text = annotationText(text);
  if (resolved !== undefined) {
    if (typeof resolved !== 'boolean') throw new CommandError('INVALID_INPUT', 'resolved must be boolean.', [annotationId]);
    annotation.resolved = resolved;
  }
  node.annotations = annotations;
  setNodeUpdated(node);
  return { document, changedIds: [node.id], skippedIds: [], result: { annotation: { ...annotation, nodeId: node.id }, bounds: getAbsoluteRect(document, node.id) }, message: `Updated annotation on ${node.name}` };
}

function deleteAnnotationMutation(document: DocumentModel, nodeId: string, annotationId: string): MutationOutcome {
  const node = assertNode(document, nodeId);
  const annotations = node.annotations ?? [];
  if (!annotations.some((candidate) => candidate.id === annotationId)) throw new CommandError('ANNOTATION_NOT_FOUND', `No annotation with the ID “${annotationId}” exists on ${node.name}.`, [node.id, annotationId]);
  node.annotations = annotations.filter((candidate) => candidate.id !== annotationId);
  setNodeUpdated(node);
  return { document, changedIds: [node.id], skippedIds: [], result: { annotationId, nodeId: node.id, bounds: getAbsoluteRect(document, node.id) }, message: `Deleted annotation from ${node.name}` };
}

function reorderMutation(document: DocumentModel, ids: string[], direction: ReorderDirection): MutationOutcome {
  const selected = effectiveSelection(document, ids);
  const skippedIds = selected.filter((id) => isEffectivelyLocked(document, id));
  const movable = selected.filter((id) => !skippedIds.includes(id));
  const changedIds: string[] = [];
  movable.forEach((id) => {
    const node = document.nodes[id];
    const siblings = node.parentId ? document.nodes[node.parentId]?.childIds : getPage(document, node.pageId)?.rootIds;
    if (!siblings) return;
    const currentIndex = siblings.indexOf(id);
    if (currentIndex < 0) return;
    const targetIndex = direction === 'front' ? siblings.length - 1 : direction === 'back' ? 0 : currentIndex + (direction === 'forward' ? 1 : -1);
    const bounded = clamp(targetIndex, 0, siblings.length - 1);
    if (bounded === currentIndex) return;
    siblings.splice(currentIndex, 1);
    siblings.splice(bounded, 0, id);
    changedIds.push(id);
  });
  return { document, changedIds, skippedIds, message: `Reordered ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
}

function reorderLayerMutation(document: DocumentModel, input: LayerReorderInput): MutationOutcome {
  const node = assertNode(document, input.id);
  if (isEffectivelyLocked(document, node.id)) return noOpOutcome(document, 'Locked elements were skipped.', [node.id]);
  const target = input.beforeId ? assertNode(document, input.beforeId) : undefined;
  if (target && target.parentId !== node.parentId) throw new CommandError('INVALID_HIERARCHY', 'Layers can only be reordered within the same parent.', [node.id, target.id]);
  const siblings = node.parentId ? document.nodes[node.parentId]?.childIds : getPage(document, node.pageId)?.rootIds;
  if (!siblings) throw new CommandError('INVALID_HIERARCHY', 'Could not find the layer sibling list.', [node.id]);
  if (target && !siblings.includes(target.id)) throw new CommandError('INVALID_TARGET', 'The target layer is not in the same sibling list.', [node.id, target.id]);
  const currentIndex = siblings.indexOf(node.id);
  if (currentIndex < 0) throw new CommandError('INVALID_TARGET', 'The layer is not in its parent sibling list.', [node.id]);
  const next = siblings.filter((id) => id !== node.id);
  const targetIndex = target ? next.indexOf(target.id) : next.length;
  if (targetIndex < 0) throw new CommandError('INVALID_TARGET', 'The target layer could not be found.', [node.id, target?.id ?? '']);
  next.splice(targetIndex, 0, node.id);
  if (next.join('|') === siblings.join('|')) return noOpOutcome(document, 'Layer order is unchanged.');
  if (node.parentId) document.nodes[node.parentId].childIds = next;
  else assertPage(document, node.pageId).rootIds = next;
  setNodeUpdated(node);
  return { document, changedIds: [node.id], skippedIds: [], result: { order: next }, message: `Reordered ${node.name}` };
}

function sharedParent(document: DocumentModel, ids: string[]): { nodes: DesignNode[]; parentId: string | null } | null {
  const nodes = effectiveSelection(document, ids).map((id) => document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
  if (!nodes.length) return null;
  const parentId = nodes[0].parentId;
  if (!nodes.every((node) => node.parentId === parentId)) return null;
  return { nodes, parentId };
}

function setLocalPosition(document: DocumentModel, node: DesignNode, absolute: Point): void {
  const parentPosition = absoluteParentPosition(document, node.parentId);
  node.x = absolute.x - parentPosition.x;
  node.y = absolute.y - parentPosition.y;
  setNodeUpdated(node);
}

function alignMutation(document: DocumentModel, ids: string[], alignment: Extract<Command, { type: 'align-elements' }>['alignment']): MutationOutcome {
  const shared = sharedParent(document, ids);
  if (!shared || shared.nodes.length < 2) throw new CommandError('INVALID_SELECTION', 'Align requires at least two siblings in the same parent.');
  const locked = shared.nodes.filter((node) => isEffectivelyLocked(document, node.id)).map((node) => node.id);
  const movable = shared.nodes.filter((node) => !locked.includes(node.id));
  if (!movable.length) return noOpOutcome(document, 'Locked elements were skipped.', locked);
  const rects = shared.nodes.map((node) => getAbsoluteRect(document, node.id));
  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const top = Math.min(...rects.map((rect) => rect.y));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const changedIds: string[] = [];
  movable.forEach((node) => {
    const rect = getAbsoluteRect(document, node.id);
    const absolute = { x: alignment === 'left' ? left : alignment === 'right' ? right - rect.width : alignment === 'horizontal-center' ? left + (right - left - rect.width) / 2 : rect.x, y: alignment === 'top' ? top : alignment === 'bottom' ? bottom - rect.height : alignment === 'vertical-center' ? top + (bottom - top - rect.height) / 2 : rect.y };
    if (absolute.x !== rect.x || absolute.y !== rect.y) {
      setLocalPosition(document, node, absolute);
      changedIds.push(node.id);
    }
  });
  return { document, changedIds, skippedIds: locked, message: `Aligned ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
}

function distributeMutation(document: DocumentModel, ids: string[], axis: 'horizontal' | 'vertical'): MutationOutcome {
  const shared = sharedParent(document, ids);
  if (!shared || shared.nodes.length < 3) throw new CommandError('INVALID_SELECTION', 'Distribute requires at least three siblings in the same parent.');
  const locked = shared.nodes.filter((node) => isEffectivelyLocked(document, node.id)).map((node) => node.id);
  const movable = shared.nodes.filter((node) => !locked.includes(node.id));
  if (movable.length < 2) return noOpOutcome(document, 'Locked elements were skipped.', locked);
  const rects = movable.map((node) => ({ node, rect: getAbsoluteRect(document, node.id) })).sort((a, b) => axis === 'horizontal' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);
  const first = rects[0].rect;
  const last = rects[rects.length - 1].rect;
  const totalSize = rects.reduce((total, item) => total + (axis === 'horizontal' ? item.rect.width : item.rect.height), 0);
  const available = (axis === 'horizontal' ? last.x + last.width - first.x : last.y + last.height - first.y) - totalSize;
  const gap = available / Math.max(1, rects.length - 1);
  let cursor = axis === 'horizontal' ? first.x : first.y;
  const changedIds: string[] = [];
  rects.forEach(({ node, rect }) => {
    const absolute = axis === 'horizontal' ? { x: cursor, y: rect.y } : { x: rect.x, y: cursor };
    if (absolute.x !== rect.x || absolute.y !== rect.y) {
      setLocalPosition(document, node, absolute);
      changedIds.push(node.id);
    }
    cursor += (axis === 'horizontal' ? rect.width : rect.height) + gap;
  });
  return { document, changedIds, skippedIds: locked, message: `Distributed ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
}

function groupMutation(document: DocumentModel, ids: string[]): MutationOutcome {
  const shared = sharedParent(document, ids);
  if (!shared || shared.nodes.length < 2 || shared.nodes.some((node) => node.type === 'artboard')) throw new CommandError('INVALID_SELECTION', 'Group requires at least two non-Frame siblings in the same free-positioned parent.');
  const parent = shared.parentId ? document.nodes[shared.parentId] : undefined;
  if (parent?.layout?.mode && parent.layout.mode !== 'free') throw new CommandError('INVALID_LAYOUT', 'Group is available for free-positioned parents.');
  const locked = shared.nodes.filter((node) => isEffectivelyLocked(document, node.id)).map((node) => node.id);
  if (locked.length) throw new CommandError('LOCKED_NODE', 'Locked elements cannot be grouped.', locked);
  const bounds = getBoundingRect(document, shared.nodes.map((node) => node.id));
  if (!bounds) throw new CommandError('INVALID_SELECTION', 'Could not measure the selected elements.');
  const pageId = shared.nodes[0].pageId;
  const frame = makeNode({ id: createId('frame'), type: 'frame', name: 'Group', isGroup: true, pageId, parentId: shared.parentId, x: bounds.x - (parent ? getAbsolutePosition(document, parent.id).x : 0), y: bounds.y - (parent ? getAbsolutePosition(document, parent.id).y : 0), width: bounds.width, height: bounds.height, layout: { ...defaultLayout(), mode: 'free' }, style: { fill: 'transparent' } });
  document.nodes[frame.id] = frame;
  const siblings = shared.parentId ? document.nodes[shared.parentId]?.childIds : getPage(document, pageId)?.rootIds;
  if (!siblings) throw new CommandError('INVALID_HIERARCHY', 'Could not find the selected sibling list.');
  const firstIndex = Math.min(...shared.nodes.map((node) => siblings.indexOf(node.id)));
  shared.nodes.forEach((node) => {
    const absolute = getAbsolutePosition(document, node.id);
    siblings.splice(siblings.indexOf(node.id), 1);
    node.parentId = frame.id;
    node.x = absolute.x - bounds.x;
    node.y = absolute.y - bounds.y;
    frame.childIds.push(node.id);
    setNodeUpdated(node);
  });
  siblings.splice(Math.max(0, firstIndex), 0, frame.id);
  document.selection = { ids: [frame.id], primaryId: frame.id };
  return { document, changedIds: [frame.id, ...shared.nodes.map((node) => node.id)], skippedIds: [], message: `Grouped ${shared.nodes.length} elements` };
}

function ungroupMutation(document: DocumentModel, ids: string[]): MutationOutcome {
  const frames = effectiveSelection(document, ids).map((id) => document.nodes[id]).filter((node): node is DesignNode => Boolean(node && node.type === 'frame'));
  if (!frames.length) throw new CommandError('INVALID_SELECTION', 'Select one or more frames to ungroup.');
  const changedIds: string[] = [];
  const skippedIds: string[] = [];
  frames.forEach((frame) => {
    if (isEffectivelyLocked(document, frame.id)) {
      skippedIds.push(frame.id);
      return;
    }
    const parentPosition = absoluteParentPosition(document, frame.parentId);
    const framePosition = getAbsolutePosition(document, frame.id);
    const siblings = frame.parentId ? document.nodes[frame.parentId]?.childIds : getPage(document, frame.pageId)?.rootIds;
    if (!siblings) return;
    const frameIndex = siblings.indexOf(frame.id);
    siblings.splice(frameIndex, 1);
    const childIds = [...frame.childIds];
    childIds.forEach((childId, index) => {
      const child = document.nodes[childId];
      if (!child || isEffectivelyLocked(document, child.id)) {
        if (child) skippedIds.push(child.id);
        return;
      }
      const absolute = getAbsolutePosition(document, child.id);
      child.parentId = frame.parentId;
      child.x = absolute.x - parentPosition.x;
      child.y = absolute.y - parentPosition.y;
      setNodeUpdated(child);
      siblings.splice(frameIndex + index, 0, child.id);
      changedIds.push(child.id);
    });
    delete document.nodes[frame.id];
    changedIds.push(frame.id);
    void framePosition;
  });
  document.selection = { ids: changedIds.filter((id) => Boolean(document.nodes[id])), primaryId: changedIds.find((id) => document.nodes[id]) ?? null };
  return { document, changedIds, skippedIds, message: `Ungrouped ${frames.length} frame${frames.length === 1 ? '' : 's'}` };
}

function validBindingKey(key: string): string {
  if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(key)) throw new CommandError('INVALID_BINDING', 'Binding keys must start with a lowercase letter and use letters, numbers, dots, hyphens, or underscores.');
  return key;
}

function bindMutation(document: DocumentModel, bindings: Array<{ nodeId: string; key: string; sourceLabel?: string }>): MutationOutcome {
  if (!bindings.length || bindings.length > 50) throw new CommandError('INVALID_BINDING', 'Provide between 1 and 50 bindings.');
  const changedIds: string[] = [];
  const failedIds: string[] = [];
  bindings.forEach((binding) => {
    const node = document.nodes[binding.nodeId];
    if (!node || (node.type !== 'text' && node.type !== 'image')) {
      failedIds.push(binding.nodeId);
      return;
    }
    if (isEffectivelyLocked(document, node.id)) {
      failedIds.push(node.id);
      return;
    }
    const key = validBindingKey(binding.key);
    node.binding = { key, sourceLabel: binding.sourceLabel?.slice(0, 120), lastUpdatedAt: nowIso(), sharedValue: node.type === 'text' ? (node.content ?? '').slice(0, MAX_TEXT_LENGTH) : node.image?.assetId };
    setNodeUpdated(node);
    changedIds.push(node.id);
  });
  return { document, changedIds, skippedIds: [], failedIds, message: `Bound ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
}

function applyContextMutation(document: DocumentModel, values: Array<{ key: string; value: ContextValue }>, force: boolean): MutationOutcome {
  if (!values.length || values.length > 30) throw new CommandError('INVALID_CONTEXT', 'Provide between 1 and 30 context values.');
  const byKey = new Map(values.map((item) => [validBindingKey(item.key), item.value]));
  const changedIds: string[] = [];
  const skippedIds: string[] = [];
  const failedIds: string[] = [];
  Object.values(document.nodes).forEach((node) => {
    if (!node.binding || !byKey.has(node.binding.key)) return;
    if (isEffectivelyLocked(document, node.id) && !force) {
      skippedIds.push(node.id);
      return;
    }
    const value = byKey.get(node.binding.key);
    if (value === undefined) return;
    try {
      if (node.type === 'text') {
        if (typeof value !== 'string') throw new CommandError('INVALID_CONTEXT', `Text binding “${node.binding.key}” needs a string value.`, [node.id]);
        if (value.length > MAX_TEXT_LENGTH) throw new CommandError('INVALID_CONTEXT', 'Context text is too long.', [node.id]);
        node.content = value;
        node.binding.sharedValue = value;
      } else if (node.type === 'image') {
        if (typeof value === 'string') {
          if (!document.assets[value]) throw new CommandError('ASSET_NOT_FOUND', `No image asset has the ID “${value}”.`, [value]);
          node.image = validateImageMetadata(document, { ...(node.image ?? {}), assetId: value });
          node.binding.sharedValue = value;
        } else {
          if (!document.assets[value.assetId]) throw new CommandError('ASSET_NOT_FOUND', `No image asset has the ID “${value.assetId}”.`, [value.assetId]);
          node.image = validateImageMetadata(document, { ...(node.image ?? {}), assetId: value.assetId, label: value.label ?? node.image?.label, alt: value.alt ?? node.image?.alt });
          node.binding.sharedValue = value.assetId;
        }
      }
      node.binding.lastUpdatedAt = nowIso();
      setNodeUpdated(node);
      changedIds.push(node.id);
  } catch {
      failedIds.push(node.id);
    }
  });
  return { document, changedIds, skippedIds, failedIds, message: `Applied context to ${changedIds.length} element${changedIds.length === 1 ? '' : 's'}` };
}

export function validateDocumentModel(document: DocumentModel, lastAction?: EditorState['lastAction'], scope: { pageId?: string; artboardIds?: string[] } = {}): ValidationReport {
  const pageIds = scope.pageId ? [scope.pageId] : document.pages.map((page) => page.id);
  const allowedIds = new Set(pageIds.flatMap((pageId) => getPageNodeIds(document, pageId)));
  const artboardFilter = scope.artboardIds?.length ? new Set(scope.artboardIds) : null;
  const nodes = [...allowedIds].map((id) => document.nodes[id]).filter((node): node is DesignNode => Boolean(node)).filter((node) => {
    const artboard = getArtboardForNode(document, node.id);
    return !artboardFilter || (artboard ? artboardFilter.has(artboard.id) : false);
  });
  const issues: ValidationIssue[] = [];
  const push = (type: ValidationIssue['type'], severity: ValidationIssue['severity'], message: string, affectedIds: string[]) => {
    issues.push({ id: createId('issue'), type, severity, message, affectedIds: affectedIds.slice(0, 6) });
  };
  nodes.forEach((node) => {
    if (node.width <= 0 || node.height <= 0 || node.width > MAX_NODE_DIMENSION || node.height > MAX_NODE_DIMENSION) push('dimensions', 'error', `${node.name} has invalid dimensions.`, [node.id]);
    if (node.type === 'text' && !(node.content ?? '').trim()) push('empty-text', 'warning', `${node.name} is empty.`, [node.id]);
    if (node.type === 'image' && (!node.image || !document.assets[node.image.assetId] || !document.assets[node.image.assetId].dataUrl.startsWith('data:image/'))) push('missing-image', 'error', `${node.name} is missing a supported local image asset.`, [node.id]);
    if (node.hidden && (node.binding || node.type === 'artboard')) push('hidden-critical', 'warning', `${node.name} is hidden but carries shared or Canvas-critical content.`, [node.id]);
    if (node.type !== 'artboard') {
      const artboard = getArtboardForNode(document, node.id);
      if (artboard) {
        const rect = getAbsoluteRect(document, node.id);
        const artRect = getAbsoluteRect(document, artboard.id);
        const overflow = rect.x < artRect.x || rect.y < artRect.y || rect.x + rect.width > artRect.x + artRect.width || rect.y + rect.height > artRect.y + artRect.height;
        if (overflow) push('overflow', 'warning', `${node.name} extends beyond ${artboard.name}.`, [node.id, artboard.id]);
      }
    }
  });
  const bindings = new Map<string, Array<{ id: string; value: string | undefined }>>();
  nodes.forEach((node) => {
    if (!node.binding) return;
    const value = node.type === 'text' ? node.content : node.image?.assetId;
    const values = bindings.get(node.binding.key) ?? [];
    values.push({ id: node.id, value });
    bindings.set(node.binding.key, values);
  });
  bindings.forEach((values, key) => {
    const distinct = new Set(values.map((item) => item.value ?? ''));
    if (distinct.size > 1) push('inconsistent-binding', 'error', `Bound values for ${key} are inconsistent.`, values.map((item) => item.id));
  });
  if (lastAction?.skippedIds.length) push('locked-conflict', 'warning', `${lastAction.skippedIds.length} locked element${lastAction.skippedIds.length === 1 ? '' : 's'} blocked the last update.`, lastAction.skippedIds);
  if (lastAction?.failedIds.length) push('export', 'warning', `${lastAction.failedIds.length} requested element update${lastAction.failedIds.length === 1 ? '' : 's'} failed.`, lastAction.failedIds);
  const counts = {
    overflow: 0,
    'missing-image': 0,
    'empty-text': 0,
    dimensions: 0,
    'inconsistent-binding': 0,
    'locked-conflict': 0,
    'hidden-critical': 0,
    export: 0,
  } satisfies Record<ValidationIssue['type'], number>;
  issues.forEach((issue) => { counts[issue.type] += 1; });
  return { valid: !issues.some((issue) => issue.severity === 'error'), revision: document.revision, scope: scope.pageId ?? (scope.artboardIds?.join(',') || 'File'), issues: issues.slice(0, 40), counts, checkedNodeCount: nodes.length };
}

export function selectNodes(state: EditorState, ids: string[], additive = false): EditorState {
  return dispatchCommand(state, { type: 'set-selection', ids, additive });
}

export function setViewport(state: EditorState, viewport: Viewport): EditorState {
  return dispatchCommand(state, { type: 'set-viewport', viewport });
}

export function selectionSummary(state: EditorState): DesignNode[] {
  return copySelectionIds(state).map((id) => state.document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
}

export function replaceDocumentState(state: EditorState, document: DocumentModel): EditorState {
  const previous = makeSnapshotState(state);
  const nextDocument = deepClone(document);
  nextDocument.id = state.activeFileId || state.document.id;
  nextDocument.selection = { ids: nextDocument.selection.ids.filter((id) => Boolean(nextDocument.nodes[id])), primaryId: nextDocument.selection.primaryId && nextDocument.nodes[nextDocument.selection.primaryId] ? nextDocument.selection.primaryId : null };
  return {
    ...state,
    document: nextDocument,
    history: [...state.history.slice(-(100 - 1)), { ...previous, label: 'Imported document' }],
    future: [],
    lastAction: { id: createId('action'), label: 'Imported document', source: 'human', changedIds: [], skippedIds: [], failedIds: [], at: Date.now() },
    focus: null,
    preview: null,
  };
}

export function createElementSpecFromNode(node: DesignNode, children?: ElementSpec[]): ElementSpec {
  return { type: node.type, name: node.name, x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation, content: node.content, style: deepClone(node.style), layout: node.layout ? deepClone(node.layout) : undefined, shape: node.shape ? deepClone(node.shape) : undefined, image: node.image ? { ...deepClone(node.image), assetId: node.image.assetId } : undefined, hidden: node.hidden, locked: node.locked, binding: node.binding ? deepClone(node.binding) : undefined, children };
}
