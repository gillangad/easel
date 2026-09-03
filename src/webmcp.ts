import {
  type ApplyContextInput,
  type Command,
  type CreateArtboardInput,
  type DeleteInput,
  type DuplicateInput,
  type InsertElementsInput,
  type UpdateElementsInput,
  type WriteArtboardInput,
  tryDispatchCommand,
  validateDocumentModel,
} from './commands';
import { ensurePreset, getAbsoluteRect, getArtboardForNode, getArtboards, getNode, getPage, getPageNodeIds } from './model';
import type {
  DesignNode,
  DocumentModel,
  EditorState,
  ElementPatch,
  ElementSpec,
  ExportFormat,
  ImageMetadata,
  LayoutStyle,
  NodeStyle,
  ToolResult,
  Viewport,
} from './types';

declare global {
  interface Document {
    modelContext?: {
      registerTool: (definition: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<void> | void;
    };
  }
}

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
};

type Bridge = {
  getState: () => EditorState;
  commit: (state: EditorState) => void;
  focus: (ids: string[]) => Promise<{ ok: boolean; message: string; targetIds: string[]; viewport?: Viewport; }>;
  capture: (artboardId: string, scale: 1 | 2, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  export: (artboardIds: string[], format: ExportFormat, scale: 1 | 2, signal?: AbortSignal) => Promise<Record<string, unknown>>;
};

const ID_SCHEMA = { type: 'string', minLength: 1, maxLength: 120 };
const POSITION_SCHEMA = {
  type: 'object',
  properties: { x: { type: 'number', minimum: -20000, maximum: 20000 }, y: { type: 'number', minimum: -20000, maximum: 20000 } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    fill: { type: 'string', maxLength: 80, description: 'A simple CSS color.' },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    borderColor: { type: 'string', maxLength: 80, description: 'A simple CSS color.' },
    borderWidth: { type: 'number', minimum: 0, maximum: 100 },
    borderRadius: { type: 'number', minimum: 0, maximum: 20000 },
    color: { type: 'string', maxLength: 80, description: 'A simple CSS color.' },
    fontFamily: { type: 'string', maxLength: 160 },
    fontSize: { type: 'number', minimum: 1, maximum: 400 },
    fontWeight: { type: 'number', enum: [400, 500, 600, 700] },
    lineHeight: { type: 'number', minimum: 0.5, maximum: 4 },
    letterSpacing: { type: 'number', minimum: -40, maximum: 80 },
    textAlign: { type: 'string', enum: ['left', 'center', 'right'] },
  },
  additionalProperties: false,
};
const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['free', 'flex-row', 'flex-column'] },
    gap: { type: 'number', minimum: 0, maximum: 1000 },
    padding: { type: 'number', minimum: 0, maximum: 1000 },
    alignItems: { type: 'string', enum: ['start', 'center', 'end', 'stretch'] },
    justifyContent: { type: 'string', enum: ['start', 'center', 'end', 'space-between'] },
    clipContent: { type: 'boolean' },
  },
  additionalProperties: false,
};
const IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    assetId: ID_SCHEMA,
    role: { type: 'string', enum: ['reference', 'content'] },
    label: { type: 'string', maxLength: 160 },
    alt: { type: 'string', maxLength: 240 },
  },
  required: ['assetId'],
  additionalProperties: false,
};
const BINDING_SCHEMA = {
  type: 'object',
  properties: { key: { type: 'string', minLength: 1, maxLength: 80 }, sourceLabel: { type: 'string', maxLength: 120 } },
  required: ['key'],
  additionalProperties: false,
};
const ELEMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['frame', 'text', 'rectangle', 'image'] },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    x: { type: 'number', minimum: -20000, maximum: 20000 },
    y: { type: 'number', minimum: -20000, maximum: 20000 },
    width: { type: 'number', minimum: 1, maximum: 20000 },
    height: { type: 'number', minimum: 1, maximum: 20000 },
    rotation: { type: 'number', minimum: -360, maximum: 360 },
    content: { type: 'string', maxLength: 6000 },
    style: STYLE_SCHEMA,
    layout: LAYOUT_SCHEMA,
    image: IMAGE_SCHEMA,
    hidden: { type: 'boolean' },
    locked: { type: 'boolean' },
    binding: BINDING_SCHEMA,
    children: { type: 'array', maxItems: 100, items: {} },
  },
  required: ['type', 'width', 'height'],
  additionalProperties: false,
};
const PATCH_SCHEMA = {
  type: 'object',
  properties: {
    id: ID_SCHEMA,
    name: { type: 'string', minLength: 1, maxLength: 120 },
    x: { type: 'number', minimum: -20000, maximum: 20000 },
    y: { type: 'number', minimum: -20000, maximum: 20000 },
    width: { type: 'number', minimum: 1, maximum: 20000 },
    height: { type: 'number', minimum: 1, maximum: 20000 },
    rotation: { type: 'number', minimum: -360, maximum: 360 },
    content: { type: 'string', maxLength: 6000 },
    style: STYLE_SCHEMA,
    layout: LAYOUT_SCHEMA,
    image: { type: 'object', properties: { assetId: ID_SCHEMA, role: { type: 'string', enum: ['reference', 'content'] }, label: { type: 'string', maxLength: 160 }, alt: { type: 'string', maxLength: 240 } }, additionalProperties: false },
    parentId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }] },
    hidden: { type: 'boolean' },
    locked: { type: 'boolean' },
  },
  required: ['id'],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'inspect_document',
    title: 'Inspect document',
    description: 'Read bounded document, page, artboard, hierarchy, text, style, image, binding, selection, lock, and revision metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['document', 'page', 'artboard', 'selection'], description: 'The document region to inspect.' },
        pageId: { ...ID_SCHEMA, description: 'Page ID for page scope.' },
        artboardId: { ...ID_SCHEMA, description: 'Artboard ID for artboard scope.' },
        maxPages: { type: 'integer', minimum: 1, maximum: 8 },
        maxArtboards: { type: 'integer', minimum: 1, maximum: 16 },
        maxNodes: { type: 'integer', minimum: 1, maximum: 80 },
        maxTextChars: { type: 'integer', minimum: 20, maximum: 600 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'inspect_selection',
    title: 'Inspect selection',
    description: 'Read precise bounded metadata for the currently selected editable elements.',
    inputSchema: { type: 'object', properties: { maxNodes: { type: 'integer', minimum: 1, maximum: 20 }, maxTextChars: { type: 'integer', minimum: 20, maximum: 600 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'focus_for_inspection',
    title: 'Focus for inspection',
    description: 'Center requested nodes or artboards, zoom them for browser vision, and temporarily hide side panels.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 8, items: ID_SCHEMA } }, required: ['ids'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'capture_artboard',
    title: 'Capture artboard',
    description: 'Render one artboard as a visible PNG preview at 1x or 2x and return bounded snapshot metadata.',
    inputSchema: { type: 'object', properties: { artboardId: ID_SCHEMA, scale: { type: 'integer', enum: [1, 2] } }, required: ['artboardId'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_artboard',
    title: 'Create artboard',
    description: 'Create a named editable artboard on the active page using explicit dimensions or a supported preset.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, width: { type: 'number', minimum: 1, maximum: 20000 }, height: { type: 'number', minimum: 1, maximum: 20000 }, preset: { type: 'string', enum: ['website-desktop', 'website-mobile', 'poster-portrait', 'a4-portrait'] }, position: POSITION_SCHEMA }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'write_artboard',
    title: 'Write artboard',
    description: 'Append or explicitly replace an artboard child tree using at most 100 editable structured nodes.',
    inputSchema: { type: 'object', properties: { artboardId: ID_SCHEMA, mode: { type: 'string', enum: ['append', 'replace'] }, elements: { type: 'array', minItems: 1, maxItems: 100, items: ELEMENT_SCHEMA }, force: { type: 'boolean', description: 'Deliberately include locked content in a replace.' } }, required: ['artboardId', 'mode', 'elements'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'insert_elements',
    title: 'Insert elements',
    description: 'Insert a bounded editable element tree into one page, artboard, or frame using the shared action layer.',
    inputSchema: { type: 'object', properties: { pageId: ID_SCHEMA, artboardId: ID_SCHEMA, parentId: ID_SCHEMA, elements: { type: 'array', minItems: 1, maxItems: 100, items: ELEMENT_SCHEMA } }, required: ['elements'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'update_elements',
    title: 'Update elements',
    description: 'Apply granular text, geometry, style, layout, image, parent, visibility, or lock patches in one undoable batch.',
    inputSchema: { type: 'object', properties: { updates: { type: 'array', minItems: 1, maxItems: 50, items: PATCH_SCHEMA }, force: { type: 'boolean', description: 'Deliberately allow writes to locked nodes.' } }, required: ['updates'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'duplicate_elements',
    title: 'Duplicate elements',
    description: 'Deep-clone explicit elements or artboards, preserving hierarchy and returning stable original-to-copy mappings.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 20, items: ID_SCHEMA }, offset: POSITION_SCHEMA, force: { type: 'boolean', description: 'Deliberately include locked roots.' } }, required: ['ids'], additionalProperties: false },
  },
  {
    name: 'delete_elements',
    title: 'Delete elements',
    description: 'Delete explicit element or artboard IDs with predictable cascading children; page IDs are rejected.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 20, items: ID_SCHEMA }, force: { type: 'boolean', description: 'Deliberately delete locked content.' } }, required: ['ids'], additionalProperties: false },
  },
  {
    name: 'bind_context_fields',
    title: 'Bind context fields',
    description: 'Attach one semantic context key such as event.title to each explicit text or image element.',
    inputSchema: { type: 'object', properties: { bindings: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { nodeId: ID_SCHEMA, key: { type: 'string', minLength: 1, maxLength: 80 }, sourceLabel: { type: 'string', maxLength: 120 } }, required: ['nodeId', 'key'], additionalProperties: false } } }, required: ['bindings'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'apply_context_values',
    title: 'Apply context values',
    description: 'Apply semantic values across all bound unlocked text or image nodes without changing their styling or layout.',
    inputSchema: { type: 'object', properties: { values: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { key: { type: 'string', minLength: 1, maxLength: 80 }, value: { anyOf: [{ type: 'string', maxLength: 6000 }, { type: 'object', properties: { assetId: ID_SCHEMA, label: { type: 'string', maxLength: 160 }, alt: { type: 'string', maxLength: 240 } }, required: ['assetId'], additionalProperties: false }] } }, required: ['key', 'value'], additionalProperties: false } }, force: { type: 'boolean', description: 'Deliberately apply values to locked nodes.' } }, required: ['values'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'validate_document',
    title: 'Validate document',
    description: 'Check a bounded scope for overflow, images, empty text, dimensions, binding consistency, locks, hidden critical content, and export blockers.',
    inputSchema: { type: 'object', properties: { pageId: ID_SCHEMA, artboardIds: { type: 'array', maxItems: 16, items: ID_SCHEMA } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'export_artboards',
    title: 'Export artboards',
    description: 'Prepare explicit artboards as PNG, SVG, static HTML/CSS, or document JSON and return actual file metadata.',
    inputSchema: { type: 'object', properties: { artboardIds: { type: 'array', minItems: 1, maxItems: 8, items: ID_SCHEMA }, format: { type: 'string', enum: ['png', 'svg', 'html', 'json'] }, scale: { type: 'integer', enum: [1, 2] } }, required: ['artboardIds', 'format'], additionalProperties: false },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, message = 'Input must be an object.'): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function assertKeys(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`Unexpected input field “${unknown}”.`);
}

function requiredString(value: Record<string, unknown>, key: string, maximum = 120): string {
  const result = value[key];
  if (typeof result !== 'string' || !result.trim() || result.length > maximum) throw new Error(`“${key}” must be a non-empty string of at most ${maximum} characters.`);
  return result.trim();
}

function optionalString(value: Record<string, unknown>, key: string, maximum = 120): string | undefined {
  if (value[key] === undefined) return undefined;
  return requiredString(value, key, maximum);
}

function finiteNumber(value: unknown, key: string, minimum = -20000, maximum = 20000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`“${key}” must be a finite number between ${minimum} and ${maximum}.`);
  return value;
}

function optionalNumber(value: Record<string, unknown>, key: string, minimum = -20000, maximum = 20000): number | undefined {
  return value[key] === undefined ? undefined : finiteNumber(value[key], key, minimum, maximum);
}

function bool(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`“${key}” must be boolean.`);
  return value;
}

function parsePosition(value: unknown, key = 'position'): { x: number; y: number } {
  const record = assertRecord(value, `${key} must be an object.`);
  assertKeys(record, ['x', 'y']);
  return { x: finiteNumber(record.x, 'x'), y: finiteNumber(record.y, 'y') };
}

function parseStyle(value: unknown): Partial<NodeStyle> {
  if (value === undefined) return {};
  const record = assertRecord(value, 'style must be an object.');
  assertKeys(record, ['fill', 'opacity', 'borderColor', 'borderWidth', 'borderRadius', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign']);
  return {
    fill: optionalString(record, 'fill', 80),
    opacity: optionalNumber(record, 'opacity', 0, 1),
    borderColor: optionalString(record, 'borderColor', 80),
    borderWidth: optionalNumber(record, 'borderWidth', 0, 100),
    borderRadius: optionalNumber(record, 'borderRadius', 0, 20000),
    color: optionalString(record, 'color', 80),
    fontFamily: optionalString(record, 'fontFamily', 160),
    fontSize: optionalNumber(record, 'fontSize', 1, 400),
    fontWeight: record.fontWeight === undefined ? undefined : (finiteNumber(record.fontWeight, 'fontWeight', 400, 700) as NodeStyle['fontWeight']),
    lineHeight: optionalNumber(record, 'lineHeight', 0.5, 4),
    letterSpacing: optionalNumber(record, 'letterSpacing', -40, 80),
    textAlign: record.textAlign === undefined ? undefined : record.textAlign as NodeStyle['textAlign'],
  };
}

function parseLayout(value: unknown): Partial<LayoutStyle> {
  if (value === undefined) return {};
  const record = assertRecord(value, 'layout must be an object.');
  assertKeys(record, ['mode', 'gap', 'padding', 'alignItems', 'justifyContent', 'clipContent']);
  return {
    mode: record.mode as LayoutStyle['mode'],
    gap: optionalNumber(record, 'gap', 0, 1000),
    padding: optionalNumber(record, 'padding', 0, 1000),
    alignItems: record.alignItems as LayoutStyle['alignItems'],
    justifyContent: record.justifyContent as LayoutStyle['justifyContent'],
    clipContent: record.clipContent === undefined ? undefined : bool(record.clipContent, 'clipContent'),
  };
}

type ParsedImage = Partial<ImageMetadata> & { assetId: string };
type ParsedImagePatch = Partial<ImageMetadata> & { assetId?: string };

function parseImage(value: unknown): ParsedImage {
  const record = assertRecord(value, 'image must be an object.');
  assertKeys(record, ['assetId', 'role', 'label', 'alt']);
  return { assetId: requiredString(record, 'assetId'), role: record.role as ImageMetadata['role'], label: optionalString(record, 'label', 160), alt: optionalString(record, 'alt', 240) };
}

function parseImagePatch(value: unknown): ParsedImagePatch | undefined {
  if (value === undefined) return undefined;
  const record = assertRecord(value, 'image must be an object.');
  assertKeys(record, ['assetId', 'role', 'label', 'alt']);
  const assetId = record.assetId === undefined ? undefined : requiredString(record, 'assetId');
  return { ...(assetId ? { assetId } : {}), role: record.role as ImageMetadata['role'], label: optionalString(record, 'label', 160), alt: optionalString(record, 'alt', 240) };
}

function parseBinding(value: unknown): ElementSpec['binding'] | undefined {
  if (value === undefined) return undefined;
  const record = assertRecord(value, 'binding must be an object.');
  assertKeys(record, ['key', 'sourceLabel', 'sharedValue']);
  return { key: requiredString(record, 'key', 80), sourceLabel: optionalString(record, 'sourceLabel', 120), sharedValue: optionalString(record, 'sharedValue', 6000) };
}

function parseElement(value: unknown, count: { value: number }): ElementSpec {
  const record = assertRecord(value, 'Each element must be an object.');
  assertKeys(record, ['type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'content', 'style', 'layout', 'image', 'hidden', 'locked', 'binding', 'children']);
  const type = requiredString(record, 'type', 20) as ElementSpec['type'];
  if (!['frame', 'text', 'rectangle', 'image'].includes(type)) throw new Error('Element type must be frame, text, rectangle, or image.');
  const children = record.children === undefined ? undefined : (() => {
    if (!Array.isArray(record.children)) throw new Error('children must be an array.');
    return record.children.map((child) => parseElement(child, count));
  })();
  count.value += 1;
  if (count.value > 100) throw new Error('An element tree may contain at most 100 nodes.');
  return {
    type,
    name: optionalString(record, 'name'),
    x: optionalNumber(record, 'x'),
    y: optionalNumber(record, 'y'),
    width: finiteNumber(record.width, 'width', 1, 20000),
    height: finiteNumber(record.height, 'height', 1, 20000),
    rotation: optionalNumber(record, 'rotation', -360, 360),
    content: record.content === undefined ? undefined : requiredString({ content: record.content }, 'content', 6000),
    style: parseStyle(record.style),
    layout: parseLayout(record.layout),
    image: type === 'image' ? parseImage(record.image) : undefined,
    hidden: record.hidden === undefined ? undefined : bool(record.hidden, 'hidden'),
    locked: record.locked === undefined ? undefined : bool(record.locked, 'locked'),
    binding: parseBinding(record.binding),
    children,
  };
}

function parseElements(value: unknown): ElementSpec[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('elements must contain between 1 and 100 nodes.');
  const count = { value: 0 };
  return value.map((element) => parseElement(element, count));
}

function parsePatch(value: unknown): ElementPatch {
  const record = assertRecord(value, 'Each update must be an object.');
  assertKeys(record, ['id', 'name', 'x', 'y', 'width', 'height', 'rotation', 'content', 'style', 'layout', 'image', 'parentId', 'hidden', 'locked']);
  const patch: ElementPatch = { id: requiredString(record, 'id') };
  if (record.name !== undefined) patch.name = requiredString(record, 'name');
  if (record.x !== undefined) patch.x = finiteNumber(record.x, 'x');
  if (record.y !== undefined) patch.y = finiteNumber(record.y, 'y');
  if (record.width !== undefined) patch.width = finiteNumber(record.width, 'width', 1, 20000);
  if (record.height !== undefined) patch.height = finiteNumber(record.height, 'height', 1, 20000);
  if (record.rotation !== undefined) patch.rotation = finiteNumber(record.rotation, 'rotation', -360, 360);
  if (record.content !== undefined) {
    if (typeof record.content !== 'string' || record.content.length > 6000) throw new Error('content must be a string of at most 6000 characters.');
    patch.content = record.content;
  }
  if (record.style !== undefined) patch.style = parseStyle(record.style);
  if (record.layout !== undefined) patch.layout = parseLayout(record.layout);
  if (record.image !== undefined) patch.image = parseImagePatch(record.image);
  if (record.parentId !== undefined) patch.parentId = record.parentId === null ? null : requiredString(record, 'parentId');
  if (record.hidden !== undefined) patch.hidden = bool(record.hidden, 'hidden');
  if (record.locked !== undefined) patch.locked = bool(record.locked, 'locked');
  return patch;
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('The tool call was cancelled.');
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function styleSummary(style: NodeStyle): Record<string, unknown> {
  return { fill: style.fill, opacity: style.opacity, borderColor: style.borderColor, borderWidth: style.borderWidth, borderRadius: style.borderRadius, color: style.color, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign };
}

function nodeSummary(document: DocumentModel, node: DesignNode, maxTextChars: number, precise = false): Record<string, unknown> {
  const rect = getAbsoluteRect(document, node.id);
  const summary: Record<string, unknown> = { id: node.id, type: node.type, name: truncate(node.name, 100), parentId: node.parentId, pageId: node.pageId, rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(node.width), height: Math.round(node.height) }, rotation: node.rotation, hidden: node.hidden, locked: node.locked, childCount: node.childIds.length };
  if (node.type === 'text') summary.text = truncate(node.content ?? '', maxTextChars);
  if (node.type === 'image') summary.image = node.image ? { assetId: node.image.assetId, originalName: truncate(node.image.originalName, 80), naturalWidth: node.image.naturalWidth, naturalHeight: node.image.naturalHeight, aspectRatio: Number(node.image.aspectRatio.toFixed(3)), role: node.image.role, label: truncate(node.image.label, 80), alt: truncate(node.image.alt, 120), palette: node.image.palette.slice(0, 6) } : null;
  if (precise || node.type === 'text' || node.type === 'frame' || node.type === 'artboard') summary.style = styleSummary(node.style);
  if (node.layout && (precise || node.type === 'frame' || node.type === 'artboard')) summary.layout = node.layout;
  if (node.binding) summary.binding = { key: node.binding.key, sourceLabel: node.binding.sourceLabel, lastUpdatedAt: node.binding.lastUpdatedAt, differsFromShared: node.type === 'text' ? node.content !== node.binding.sharedValue : node.image?.assetId !== node.binding.sharedValue };
  return summary;
}

function boundResult(result: Record<string, unknown>, fallbackMessage = 'Narrow the scope or lower the limits to inspect more detail.'): ToolResult {
  const serialized = JSON.stringify(result);
  if (serialized.length <= 1450) return result as ToolResult;
  return {
    ok: result.ok === false ? false : true,
    truncated: true,
    message: fallbackMessage,
    revision: result.revision,
    counts: result.counts,
    returnedCharacters: 0,
  };
}

function errorResult(error: unknown, code = 'INVALID_INPUT'): ToolResult {
  const message = error instanceof Error ? error.message : 'The tool input could not be processed.';
  return { ok: false, message, error: { code, message } };
}

function mutationResult(state: EditorState, action: string): ToolResult {
  const last = state.lastAction;
  return {
    ok: true,
    action,
    message: last?.label ?? 'Action completed.',
    changedIds: last?.changedIds ?? [],
    skippedIds: last?.skippedIds ?? [],
    failedIds: last?.failedIds ?? [],
    revision: state.document.revision,
  };
}

function commitCommand(bridge: Bridge, command: Command, action: string): ToolResult {
  const current = bridge.getState();
  const outcome = tryDispatchCommand(current, command);
  if (outcome.error) return { ok: false, action, message: outcome.error.message, error: { code: outcome.error.code, message: outcome.error.message, affectedIds: outcome.error.affectedIds } };
  if (outcome.state !== current) bridge.commit(outcome.state);
  return mutationResult(outcome.state, action);
}

function inspectDocument(state: EditorState, input: unknown): ToolResult {
  const record = assertRecord(input);
  assertKeys(record, ['scope', 'pageId', 'artboardId', 'maxPages', 'maxArtboards', 'maxNodes', 'maxTextChars']);
  const scope = record.scope === undefined ? 'document' : requiredString(record, 'scope', 20);
  if (!['document', 'page', 'artboard', 'selection'].includes(scope)) throw new Error('scope must be document, page, artboard, or selection.');
  const maxPages = record.maxPages === undefined ? 4 : Math.round(finiteNumber(record.maxPages, 'maxPages', 1, 8));
  const maxArtboards = record.maxArtboards === undefined ? 8 : Math.round(finiteNumber(record.maxArtboards, 'maxArtboards', 1, 16));
  const maxNodes = record.maxNodes === undefined ? 28 : Math.round(finiteNumber(record.maxNodes, 'maxNodes', 1, 80));
  const maxTextChars = record.maxTextChars === undefined ? 180 : Math.round(finiteNumber(record.maxTextChars, 'maxTextChars', 20, 600));
  const pageId = optionalString(record, 'pageId');
  const artboardId = optionalString(record, 'artboardId');
  let pageIds: string[] = [];
  let nodeIds: string[] = [];
  if (scope === 'document') {
    pageIds = state.document.pages.slice(0, maxPages).map((page) => page.id);
    nodeIds = pageIds.flatMap((id) => getPageNodeIds(state.document, id));
  } else if (scope === 'page') {
    if (!pageId) throw new Error('pageId is required for page scope.');
    pageIds = [getPage(state.document, pageId)?.id ?? ''];
    if (!pageIds[0]) throw new Error(`No page has the ID “${pageId}”.`);
    nodeIds = getPageNodeIds(state.document, pageIds[0]);
  } else if (scope === 'artboard') {
    if (!artboardId) throw new Error('artboardId is required for artboard scope.');
    const artboard = getNode(state.document, artboardId);
    if (!artboard || artboard.type !== 'artboard') throw new Error(`No artboard has the ID “${artboardId}”.`);
    pageIds = [artboard.pageId];
    nodeIds = getPageNodeIds(state.document, artboard.pageId).filter((id) => id === artboard.id || Boolean(getArtboardForNode(state.document, id)?.id === artboard.id));
  } else {
    nodeIds = state.document.selection.ids;
    pageIds = [...new Set(nodeIds.map((id) => state.document.nodes[id]?.pageId).filter((id): id is string => Boolean(id)))].slice(0, maxPages);
  }
  const nodes = nodeIds.slice(0, maxNodes).map((id) => state.document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
  const artboards = pageIds.flatMap((id) => getArtboards(state.document, id)).filter((node) => scope !== 'artboard' || node.id === artboardId).slice(0, maxArtboards).map((node) => nodeSummary(state.document, node, maxTextChars));
  const result = {
    ok: true,
    revision: state.document.revision,
    document: { id: state.document.id, name: truncate(state.document.name, 120), activePageId: state.document.activePageId, pageCount: state.document.pages.length, assetCount: Object.keys(state.document.assets).length },
    pages: pageIds.map((id) => getPage(state.document, id)).filter((page): page is NonNullable<typeof page> => Boolean(page)).slice(0, maxPages).map((page) => ({ id: page.id, name: truncate(page.name, 80), rootCount: page.rootIds.length })),
    artboards,
    nodes: nodes.map((node) => nodeSummary(state.document, node, maxTextChars)),
    selection: state.document.selection,
    limits: { maxPages, maxArtboards, maxNodes, maxTextChars },
    returnedNodeCount: nodes.length,
    truncated: nodeIds.length > nodes.length,
  };
  return boundResult(result);
}

function inspectSelection(state: EditorState, input: unknown): ToolResult {
  const record = assertRecord(input);
  assertKeys(record, ['maxNodes', 'maxTextChars']);
  const maxNodes = record.maxNodes === undefined ? 12 : Math.round(finiteNumber(record.maxNodes, 'maxNodes', 1, 20));
  const maxTextChars = record.maxTextChars === undefined ? 360 : Math.round(finiteNumber(record.maxTextChars, 'maxTextChars', 20, 600));
  const nodes = state.document.selection.ids.slice(0, maxNodes).map((id) => state.document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
  return boundResult({ ok: true, revision: state.document.revision, selection: state.document.selection, nodes: nodes.map((node) => nodeSummary(state.document, node, maxTextChars, true)), returnedNodeCount: nodes.length, truncated: state.document.selection.ids.length > nodes.length });
}

function parseCreateArtboard(input: unknown): CreateArtboardInput {
  const record = assertRecord(input);
  assertKeys(record, ['name', 'width', 'height', 'preset', 'position']);
  const result: CreateArtboardInput = { name: requiredString(record, 'name') };
  if (record.width !== undefined) result.width = finiteNumber(record.width, 'width', 1, 20000);
  if (record.height !== undefined) result.height = finiteNumber(record.height, 'height', 1, 20000);
  if (record.preset !== undefined) result.preset = requiredString(record, 'preset', 40) as CreateArtboardInput['preset'];
  if (result.preset && !ensurePreset(result.preset)) throw new Error(`Unsupported artboard preset “${result.preset}”.`);
  if (!result.preset && (result.width === undefined || result.height === undefined)) throw new Error('Provide both width and height, or a supported preset.');
  if (result.preset && (result.width !== undefined || result.height !== undefined)) throw new Error('Provide either preset or explicit width and height, not both.');
  if (record.position !== undefined) result.position = parsePosition(record.position);
  return result;
}

function parseWriteArtboard(input: unknown): WriteArtboardInput {
  const record = assertRecord(input);
  assertKeys(record, ['artboardId', 'mode', 'elements', 'force']);
  const mode = requiredString(record, 'mode', 20);
  if (mode !== 'append' && mode !== 'replace') throw new Error('mode must be append or replace.');
  return { artboardId: requiredString(record, 'artboardId'), mode, elements: parseElements(record.elements), force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseInsert(input: unknown): InsertElementsInput {
  const record = assertRecord(input);
  assertKeys(record, ['pageId', 'artboardId', 'parentId', 'elements']);
  const targetCount = [record.pageId, record.artboardId, record.parentId].filter((value) => value !== undefined).length;
  if (targetCount !== 1) throw new Error('Provide exactly one of pageId, artboardId, or parentId.');
  return { pageId: optionalString(record, 'pageId'), artboardId: optionalString(record, 'artboardId'), parentId: optionalString(record, 'parentId'), elements: parseElements(record.elements) };
}

function parseUpdate(input: unknown): UpdateElementsInput {
  const record = assertRecord(input);
  assertKeys(record, ['updates', 'force']);
  if (!Array.isArray(record.updates) || !record.updates.length || record.updates.length > 50) throw new Error('updates must contain between 1 and 50 items.');
  return { updates: record.updates.map(parsePatch), force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseIds(input: unknown, field = 'ids', maximum = 20): string[] {
  const record = assertRecord(input);
  const value = record[field];
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum || !value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120)) throw new Error(`${field} must contain between 1 and ${maximum} element IDs.`);
  return [...new Set(value as string[])];
}

function parseDuplicate(input: unknown): DuplicateInput {
  const record = assertRecord(input);
  assertKeys(record, ['ids', 'offset', 'force']);
  return { ids: parseIds(record), offset: record.offset === undefined ? undefined : parsePosition(record.offset, 'offset'), force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseDelete(input: unknown): DeleteInput {
  const record = assertRecord(input);
  assertKeys(record, ['ids', 'force']);
  return { ids: parseIds(record), force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseContextApply(input: unknown): ApplyContextInput {
  const record = assertRecord(input);
  assertKeys(record, ['values', 'force']);
  if (!Array.isArray(record.values) || record.values.length < 1 || record.values.length > 30) throw new Error('values must contain between 1 and 30 items.');
  const values = record.values.map((raw) => {
    const item = assertRecord(raw);
    assertKeys(item, ['key', 'value']);
    const key = requiredString(item, 'key', 80);
    const value = item.value;
    if (typeof value === 'string') return { key, value: value.slice(0, 6000) };
    const image = assertRecord(value, 'value must be a string or image asset object.');
    assertKeys(image, ['assetId', 'label', 'alt']);
    return { key, value: { assetId: requiredString(image, 'assetId'), label: optionalString(image, 'label', 160), alt: optionalString(image, 'alt', 240) } };
  });
  return { values, force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseBindings(input: unknown): Array<{ nodeId: string; key: string; sourceLabel?: string }> {
  const record = assertRecord(input);
  assertKeys(record, ['bindings']);
  if (!Array.isArray(record.bindings) || record.bindings.length < 1 || record.bindings.length > 50) throw new Error('bindings must contain between 1 and 50 items.');
  return record.bindings.map((raw) => {
    const binding = assertRecord(raw);
    assertKeys(binding, ['nodeId', 'key', 'sourceLabel']);
    return { nodeId: requiredString(binding, 'nodeId'), key: requiredString(binding, 'key', 80), sourceLabel: optionalString(binding, 'sourceLabel', 120) };
  });
}

function parseValidate(input: unknown): { pageId?: string; artboardIds?: string[] } {
  const record = assertRecord(input);
  assertKeys(record, ['pageId', 'artboardIds']);
  const artboardIds = record.artboardIds === undefined ? undefined : (() => {
    if (!Array.isArray(record.artboardIds) || record.artboardIds.length > 16 || !record.artboardIds.every((id) => typeof id === 'string')) throw new Error('artboardIds must contain at most 16 IDs.');
    return record.artboardIds as string[];
  })();
  return { pageId: optionalString(record, 'pageId'), artboardIds };
}

function parseExport(input: unknown): { artboardIds: string[]; format: ExportFormat; scale: 1 | 2 } {
  const record = assertRecord(input);
  assertKeys(record, ['artboardIds', 'format', 'scale']);
  const ids = parseIds(record, 'artboardIds', 8);
  const format = requiredString(record, 'format', 10) as ExportFormat;
  if (!['png', 'svg', 'html', 'json'].includes(format)) throw new Error('format must be png, svg, html, or json.');
  const scale = record.scale === undefined ? 1 : Math.round(finiteNumber(record.scale, 'scale', 1, 2)) as 1 | 2;
  if (scale !== 1 && scale !== 2) throw new Error('scale must be 1 or 2.');
  return { artboardIds: ids, format, scale };
}

export function createToolBridge(bridge: Bridge): { invoke: (name: string, input: unknown, signal?: AbortSignal) => Promise<ToolResult>; definitions: ToolDefinition[] } {
  const invoke = async (name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult> => {
    try {
      ensureNotAborted(signal);
      const state = bridge.getState();
      switch (name) {
        case 'inspect_document': return inspectDocument(state, input);
        case 'inspect_selection': return inspectSelection(state, input);
        case 'focus_for_inspection': {
          const record = assertRecord(input);
          assertKeys(record, ['ids']);
          const ids = parseIds(record, 'ids', 8);
          if (ids.some((id) => !state.document.nodes[id])) throw new Error('Every focus ID must reference an existing node or artboard.');
          const focused = await bridge.focus(ids);
          return boundResult({ ok: focused.ok, message: focused.message, targetIds: focused.targetIds, viewport: focused.viewport, previewOpen: false });
        }
        case 'capture_artboard': {
          const record = assertRecord(input);
          assertKeys(record, ['artboardId', 'scale']);
          const artboardId = requiredString(record, 'artboardId');
          const node = getNode(state.document, artboardId);
          if (!node || node.type !== 'artboard') throw new Error(`No artboard has the ID “${artboardId}”.`);
          const scale = record.scale === undefined ? 1 : Math.round(finiteNumber(record.scale, 'scale', 1, 2)) as 1 | 2;
          if (scale !== 1 && scale !== 2) throw new Error('scale must be 1 or 2.');
          return boundResult(await bridge.capture(artboardId, scale, signal));
        }
        case 'create_artboard': return commitCommand(bridge, { type: 'create-artboard', ...parseCreateArtboard(input), source: 'agent' }, name);
        case 'write_artboard': return commitCommand(bridge, { type: 'write-artboard', ...parseWriteArtboard(input), source: 'agent' }, name);
        case 'insert_elements': return commitCommand(bridge, { type: 'insert-elements', ...parseInsert(input), source: 'agent' }, name);
        case 'update_elements': return commitCommand(bridge, { type: 'update-elements', ...parseUpdate(input), source: 'agent' }, name);
        case 'duplicate_elements': return commitCommand(bridge, { type: 'duplicate-elements', ...parseDuplicate(input), source: 'agent' }, name);
        case 'delete_elements': {
          const parsed = parseDelete(input);
          if (parsed.ids.some((id) => state.document.pages.some((page) => page.id === id))) throw new Error('delete_elements accepts node or artboard IDs, not page IDs.');
          return commitCommand(bridge, { type: 'delete-elements', ...parsed, source: 'agent' }, name);
        }
        case 'bind_context_fields': return commitCommand(bridge, { type: 'bind-context', bindings: parseBindings(input), source: 'agent' }, name);
        case 'apply_context_values': return commitCommand(bridge, { type: 'apply-context', ...parseContextApply(input), source: 'agent' }, name);
        case 'validate_document': {
          const scope = parseValidate(input);
          return boundResult({ ok: true, message: 'Validation completed.', ...validateDocumentModel(state.document, state.lastAction, scope) });
        }
        case 'export_artboards': {
          const parsed = parseExport(input);
          ensureNotAborted(signal);
          return boundResult(await bridge.export(parsed.artboardIds, parsed.format, parsed.scale, signal));
        }
        default: return errorResult(new Error(`Unknown tool “${name}”.`), 'UNKNOWN_TOOL');
      }
    } catch (error) {
      return errorResult(error);
    }
  };
  return { invoke, definitions: TOOL_DEFINITIONS };
}

export async function registerWebMCPTools(bridge: Bridge): Promise<{ supported: boolean; registered: boolean; cleanup: () => void; error?: string }> {
  const context = typeof document !== 'undefined' ? document.modelContext : undefined;
  if (!context || typeof context.registerTool !== 'function') return { supported: false, registered: false, cleanup: () => undefined };
  const controller = new AbortController();
  const toolBridge = createToolBridge(bridge);
  try {
    for (const definition of toolBridge.definitions) {
      await context.registerTool({
        ...definition,
        execute: async (input: unknown, meta?: { signal?: AbortSignal }) => toolBridge.invoke(definition.name, input, meta?.signal),
      }, { signal: controller.signal });
    }
    return { supported: true, registered: true, cleanup: () => controller.abort() };
  } catch (error) {
    controller.abort();
    return { supported: true, registered: false, cleanup: () => undefined, error: error instanceof Error ? error.message : 'WebMCP registration failed.' };
  }
}

export function toolSchemasAreStrict(): boolean {
  return TOOL_DEFINITIONS.every((definition) => definition.inputSchema.type === 'object' && definition.inputSchema.additionalProperties === false);
}
