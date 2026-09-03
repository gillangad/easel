import {
  type ApplyContextInput,
  type Command,
  type CreateArtboardInput,
  type DeleteInput,
  type DuplicateInput,
  type InsertElementsInput,
  type UpdateElementsInput,
  type WriteArtboardInput,
  CommandError,
  resolveSemanticTarget,
  tryDispatchCommand,
  validateDocumentModel,
} from './commands';
import { createId, deepClone, ensurePreset, getAbsoluteRect, getArtboardForNode, getArtboards, getDescendantIds, getNode, getPageNodeIds, matchesSemanticTarget, syncActiveFile } from './model';
import type {
  DesignNode,
  DocumentModel,
  EditorState,
  ElementPatch,
  ElementSpec,
  ExportFormat,
  EaselFile,
  ImageAsset,
  ImageMetadata,
  LayoutStyle,
  NodeStyle,
  SemanticTarget,
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

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; untrustedContentHint?: boolean };
};

type Bridge = {
  getState: () => EditorState;
  commit: (state: EditorState) => void;
  focus: (ids: string[]) => Promise<{ ok: boolean; message: string; targetIds: string[]; viewport?: Viewport }>;
  capture: (frameId: string, scale: 1 | 2, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  export: (frameIds: string[], format: ExportFormat, scale: 1 | 2, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  openFile?: (target: { fileId?: string; fileName?: string }) => Promise<Record<string, unknown>>;
  beginAgentWork?: (ids: string[]) => string;
  completeAgentWork?: (token: string, ids: string[], success: boolean, mutation: boolean) => void;
  reveal?: (ids: string[]) => void;
};

const ID_SCHEMA = { type: 'string', minLength: 1, maxLength: 120 };
const FRAME_TYPE_SCHEMA = { type: 'string', enum: ['frame', 'text', 'rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'image'] };
const SEMANTIC_TARGET_SCHEMA = {
  type: 'object',
  properties: {
    fileId: ID_SCHEMA,
    fileName: { type: 'string', minLength: 1, maxLength: 120 },
    frameId: ID_SCHEMA,
    frameName: { type: 'string', minLength: 1, maxLength: 120 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    type: FRAME_TYPE_SCHEMA,
    content: { type: 'string', maxLength: 6000 },
    bindingKey: { type: 'string', minLength: 1, maxLength: 80 },
  },
  additionalProperties: false,
};
const POSITION_SCHEMA = {
  type: 'object',
  properties: { x: { type: 'number', minimum: -20000, maximum: 20000 }, y: { type: 'number', minimum: -20000, maximum: 20000 } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const STYLE_SCHEMA = {
  type: 'object',
  properties: {
    fill: { type: 'string', maxLength: 80 },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
    borderColor: { type: 'string', maxLength: 80 },
    borderWidth: { type: 'number', minimum: 0, maximum: 100 },
    borderStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
    borderRadius: { type: 'number', minimum: 0, maximum: 20000 },
    color: { type: 'string', maxLength: 80 },
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
    type: FRAME_TYPE_SCHEMA,
    name: { type: 'string', minLength: 1, maxLength: 120 },
    x: { type: 'number', minimum: -20000, maximum: 20000 },
    y: { type: 'number', minimum: -20000, maximum: 20000 },
    width: { type: 'number', minimum: 1, maximum: 20000 },
    height: { type: 'number', minimum: 1, maximum: 20000 },
    rotation: { type: 'number', minimum: -360, maximum: 360 },
    content: { type: 'string', maxLength: 6000 },
    style: STYLE_SCHEMA,
    layout: LAYOUT_SCHEMA,
    shape: { type: 'object', properties: { sides: { type: 'integer', minimum: 3, maximum: 12 } }, additionalProperties: false },
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
    target: SEMANTIC_TARGET_SCHEMA,
    name: { type: 'string', minLength: 1, maxLength: 120 },
    x: { type: 'number', minimum: -20000, maximum: 20000 },
    y: { type: 'number', minimum: -20000, maximum: 20000 },
    width: { type: 'number', minimum: 1, maximum: 20000 },
    height: { type: 'number', minimum: 1, maximum: 20000 },
    rotation: { type: 'number', minimum: -360, maximum: 360 },
    content: { type: 'string', maxLength: 6000 },
    style: STYLE_SCHEMA,
    layout: LAYOUT_SCHEMA,
    shape: { type: 'object', properties: { sides: { type: 'integer', minimum: 3, maximum: 12 } }, additionalProperties: false },
    image: { type: 'object', properties: { assetId: ID_SCHEMA, role: { type: 'string', enum: ['reference', 'content'] }, label: { type: 'string', maxLength: 160 }, alt: { type: 'string', maxLength: 240 } }, additionalProperties: false },
    parentId: { anyOf: [{ type: 'string', minLength: 1, maxLength: 120 }, { type: 'null' }] },
    hidden: { type: 'boolean' },
    locked: { type: 'boolean' },
  },
  oneOf: [
    { required: ['id'], not: { required: ['target'] } },
    { required: ['target'], not: { required: ['id'] } },
  ],
  additionalProperties: false,
};
const FILE_TARGET_SCHEMA = {
  type: 'object',
  properties: { fileId: ID_SCHEMA, fileName: { type: 'string', minLength: 1, maxLength: 120 }, frameId: ID_SCHEMA, frameName: { type: 'string', minLength: 1, maxLength: 120 }, name: { type: 'string', minLength: 1, maxLength: 120 } },
  oneOf: [{ required: ['frameId'] }, { required: ['frameName'] }],
  additionalProperties: false,
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'inspect_document',
    title: 'Inspect File',
    description: 'Read a compact, filterable, paginated summary of the active Easel File, its Canvas, Frames, Layers, bindings, assets, and selection.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: ID_SCHEMA,
        fileName: { type: 'string', minLength: 1, maxLength: 120 },
        scope: { type: 'string', enum: ['file', 'frame', 'selection'] },
        frameId: ID_SCHEMA,
        frameName: { type: 'string', minLength: 1, maxLength: 120 },
        nodeIds: { type: 'array', maxItems: 20, items: ID_SCHEMA },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        type: FRAME_TYPE_SCHEMA,
        content: { type: 'string', maxLength: 6000 },
        bindingKey: { type: 'string', minLength: 1, maxLength: 80 },
        maxFrames: { type: 'integer', minimum: 1, maximum: 8 },
        maxLayers: { type: 'integer', minimum: 1, maximum: 80 },
        maxTextChars: { type: 'integer', minimum: 20, maximum: 600 },
        offset: { type: 'integer', minimum: 0 },
        detail: { type: 'string', enum: ['compact', 'full'] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'open_file',
    title: 'Open File',
    description: 'Switch to one saved Easel File by exact ID or exact name and return its active summary.',
    inputSchema: { type: 'object', properties: { fileId: ID_SCHEMA, fileName: { type: 'string', minLength: 1, maxLength: 120 } }, oneOf: [{ required: ['fileId'] }, { required: ['fileName'] }], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'inspect_assets',
    title: 'Inspect assets',
    description: 'Read compact asset names, sources, types, dimensions, and stable asset IDs with exact filters and pagination.',
    inputSchema: { type: 'object', properties: { fileId: ID_SCHEMA, fileName: { type: 'string', minLength: 1, maxLength: 120 }, name: { type: 'string', minLength: 1, maxLength: 160 }, source: { type: 'string', minLength: 1, maxLength: 40 }, type: { type: 'string', enum: ['image'] }, assetId: ID_SCHEMA, maxAssets: { type: 'integer', minimum: 1, maximum: 40 }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'focus_for_inspection',
    title: 'Focus for inspection',
    description: 'Center requested Layers or Frames for visual inspection and temporarily hide side panels.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 8, items: ID_SCHEMA } }, required: ['ids'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'capture_frame',
    title: 'Capture Frame',
    description: 'Render one Frame as a visible PNG preview at 1x or 2x and return bounded snapshot metadata.',
    inputSchema: { type: 'object', properties: { frameId: ID_SCHEMA, scale: { type: 'integer', enum: [1, 2] } }, required: ['frameId'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_frame',
    title: 'Create Frame',
    description: 'Create a named Website, Graphic, or custom-size Frame on the active Canvas.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, width: { type: 'number', minimum: 1, maximum: 20000 }, height: { type: 'number', minimum: 1, maximum: 20000 }, preset: { type: 'string', enum: ['website', 'website-mobile', 'graphic'] }, position: POSITION_SCHEMA }, required: ['name'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'write_frame',
    title: 'Write Frame',
    description: 'Append or explicitly replace a Frame child tree using at most 100 editable structured Layers.',
    inputSchema: { type: 'object', properties: { frameId: ID_SCHEMA, mode: { type: 'string', enum: ['append', 'replace'] }, elements: { type: 'array', minItems: 1, maxItems: 100, items: ELEMENT_SCHEMA }, force: { type: 'boolean', description: 'Deliberately include locked content in a replace.' } }, required: ['frameId', 'mode', 'elements'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'insert_elements',
    title: 'Insert Layers',
    description: 'Insert a bounded editable Layer tree into one exact Frame using the shared action layer.',
    inputSchema: { type: 'object', properties: { frameId: ID_SCHEMA, parentId: ID_SCHEMA, elements: { type: 'array', minItems: 1, maxItems: 100, items: ELEMENT_SCHEMA } }, required: ['elements'], oneOf: [{ required: ['frameId'] }, { required: ['parentId'] }], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'update_elements',
    title: 'Update Layers',
    description: 'Apply granular text, geometry, typography, appearance, layout, shape, image, visibility, or lock patches in one undoable batch.',
    inputSchema: { type: 'object', properties: { updates: { type: 'array', minItems: 1, maxItems: 50, items: PATCH_SCHEMA }, force: { type: 'boolean', description: 'Deliberately allow writes to locked Layers.' } }, required: ['updates'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'duplicate_elements',
    title: 'Duplicate Layers',
    description: 'Deep-clone explicit Layers or Frames, preserving hierarchy and returning stable mappings.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 20, items: ID_SCHEMA }, offset: POSITION_SCHEMA, force: { type: 'boolean', description: 'Deliberately include locked roots.' } }, required: ['ids'], additionalProperties: false },
  },
  {
    name: 'delete_elements',
    title: 'Delete Layers',
    description: 'Delete explicit Layers or Frames with predictable cascading children.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', minItems: 1, maxItems: 20, items: ID_SCHEMA }, force: { type: 'boolean', description: 'Deliberately delete locked content.' } }, required: ['ids'], additionalProperties: false },
    annotations: { destructiveHint: true, untrustedContentHint: true },
  },
  {
    name: 'bind_context_fields',
    title: 'Bind context fields',
    description: 'Attach one semantic context key such as event.title to exact text or image Layers.',
    inputSchema: { type: 'object', properties: { bindings: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { nodeId: ID_SCHEMA, target: SEMANTIC_TARGET_SCHEMA, key: { type: 'string', minLength: 1, maxLength: 80 }, sourceLabel: { type: 'string', maxLength: 120 } }, required: ['key'], oneOf: [{ required: ['nodeId'] }, { required: ['target'] }], additionalProperties: false } } }, required: ['bindings'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'apply_context_values',
    title: 'Apply context values',
    description: 'Apply semantic values across all bound unlocked text or image Layers without changing their styling or layout.',
    inputSchema: { type: 'object', properties: { values: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { key: { type: 'string', minLength: 1, maxLength: 80 }, value: { anyOf: [{ type: 'string', maxLength: 6000 }, { type: 'object', properties: { assetId: ID_SCHEMA, label: { type: 'string', maxLength: 160 }, alt: { type: 'string', maxLength: 240 } }, required: ['assetId'], additionalProperties: false }] } }, required: ['key', 'value'], additionalProperties: false } }, force: { type: 'boolean', description: 'Deliberately apply values to locked Layers.' } }, required: ['values'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'import_and_place_asset',
    title: 'Import and place asset',
    description: 'Create or deduplicate one small image Asset from data and place it at an exact position inside a Frame.',
    inputSchema: { type: 'object', properties: { data: { type: 'string', minLength: 1, maxLength: 1500000 }, filename: { type: 'string', minLength: 1, maxLength: 160 }, mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] }, source: { type: 'string', maxLength: 40 }, target: FILE_TARGET_SCHEMA, position: POSITION_SCHEMA, width: { type: 'number', minimum: 1, maximum: 12000 }, height: { type: 'number', minimum: 1, maximum: 12000 }, name: { type: 'string', maxLength: 120 }, alt: { type: 'string', maxLength: 240 } }, required: ['data', 'filename', 'mimeType', 'target', 'position'], additionalProperties: false },
    annotations: { untrustedContentHint: true },
  },
  {
    name: 'validate_document',
    title: 'Validate File',
    description: 'Check Frames and Layers for overflow, images, empty text, dimensions, binding consistency, locks, hidden critical content, and export blockers.',
    inputSchema: { type: 'object', properties: { frameIds: { type: 'array', maxItems: 16, items: ID_SCHEMA } }, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
  },
  {
    name: 'export_frames',
    title: 'Export Frames',
    description: 'Prepare explicit Frames as PNG, SVG, static HTML/CSS, or File JSON and return actual file metadata.',
    inputSchema: { type: 'object', properties: { frameIds: { type: 'array', minItems: 1, maxItems: 8, items: ID_SCHEMA }, format: { type: 'string', enum: ['png', 'svg', 'html', 'json'] }, scale: { type: 'integer', enum: [1, 2] } }, required: ['frameIds', 'format'], additionalProperties: false },
    annotations: { readOnlyHint: true },
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

function exactContent(value: Record<string, unknown>, key: string, maximum = 6000): string | undefined {
  if (value[key] === undefined) return undefined;
  if (typeof value[key] !== 'string' || (value[key] as string).length > maximum) throw new Error(`“${key}” must be a string of at most ${maximum} characters.`);
  return value[key] as string;
}

function finiteNumber(value: unknown, key: string, minimum = -20000, maximum = 20000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`“${key}” must be a finite number between ${minimum} and ${maximum}.`);
  return value;
}

function bool(value: unknown, key: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`“${key}” must be boolean.`);
  return value;
}

function parsePosition(value: unknown, key = 'position'): { x: number; y: number } {
  const record = assertRecord(value, `${key} must be an object.`);
  assertKeys(record, ['x', 'y']);
  return { x: finiteNumber(record.x, `${key}.x`), y: finiteNumber(record.y, `${key}.y`) };
}

function parseStyle(value: unknown): Partial<NodeStyle> {
  const record = assertRecord(value, 'style must be an object.');
  assertKeys(record, ['fill', 'opacity', 'borderColor', 'borderWidth', 'borderStyle', 'borderRadius', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign']);
  return {
    fill: optionalString(record, 'fill', 80),
    opacity: record.opacity === undefined ? undefined : finiteNumber(record.opacity, 'style.opacity', 0, 1),
    borderColor: optionalString(record, 'borderColor', 80),
    borderWidth: record.borderWidth === undefined ? undefined : finiteNumber(record.borderWidth, 'style.borderWidth', 0, 100),
    borderStyle: record.borderStyle === undefined ? undefined : requiredString(record, 'borderStyle', 10) as NodeStyle['borderStyle'],
    borderRadius: record.borderRadius === undefined ? undefined : finiteNumber(record.borderRadius, 'style.borderRadius', 0, 20000),
    color: optionalString(record, 'color', 80),
    fontFamily: optionalString(record, 'fontFamily', 160),
    fontSize: record.fontSize === undefined ? undefined : finiteNumber(record.fontSize, 'style.fontSize', 1, 400),
    fontWeight: record.fontWeight === undefined ? undefined : Math.round(finiteNumber(record.fontWeight, 'style.fontWeight', 400, 700)) as NodeStyle['fontWeight'],
    lineHeight: record.lineHeight === undefined ? undefined : finiteNumber(record.lineHeight, 'style.lineHeight', 0.5, 4),
    letterSpacing: record.letterSpacing === undefined ? undefined : finiteNumber(record.letterSpacing, 'style.letterSpacing', -40, 80),
    textAlign: record.textAlign === undefined ? undefined : requiredString(record, 'textAlign', 10) as NodeStyle['textAlign'],
  };
}

function parseLayout(value: unknown): Partial<LayoutStyle> {
  const record = assertRecord(value, 'layout must be an object.');
  assertKeys(record, ['mode', 'gap', 'padding', 'alignItems', 'justifyContent', 'clipContent']);
  return {
    mode: record.mode === undefined ? undefined : requiredString(record, 'mode', 20) as LayoutStyle['mode'],
    gap: record.gap === undefined ? undefined : finiteNumber(record.gap, 'layout.gap', 0, 1000),
    padding: record.padding === undefined ? undefined : finiteNumber(record.padding, 'layout.padding', 0, 1000),
    alignItems: record.alignItems === undefined ? undefined : requiredString(record, 'alignItems', 20) as LayoutStyle['alignItems'],
    justifyContent: record.justifyContent === undefined ? undefined : requiredString(record, 'justifyContent', 30) as LayoutStyle['justifyContent'],
    clipContent: record.clipContent === undefined ? undefined : bool(record.clipContent, 'layout.clipContent'),
  };
}

function parseShape(value: unknown): { sides?: number } {
  const record = assertRecord(value, 'shape must be an object.');
  assertKeys(record, ['sides']);
  return { sides: record.sides === undefined ? undefined : Math.round(finiteNumber(record.sides, 'shape.sides', 3, 12)) };
}

type ParsedImage = Partial<ImageMetadata> & { assetId: string };
type ParsedImagePatch = Partial<ImageMetadata> & { assetId?: string };

function parseImage(value: unknown): ParsedImage {
  const record = assertRecord(value, 'image must be an object.');
  assertKeys(record, ['assetId', 'role', 'label', 'alt']);
  return { assetId: requiredString(record, 'assetId'), role: record.role === 'content' ? 'content' : 'reference', label: optionalString(record, 'label', 160), alt: optionalString(record, 'alt', 240) };
}

function parseImagePatch(value: unknown): ParsedImagePatch | undefined {
  if (value === undefined) return undefined;
  const record = assertRecord(value, 'image must be an object.');
  assertKeys(record, ['assetId', 'role', 'label', 'alt']);
  return { assetId: optionalString(record, 'assetId'), role: record.role === undefined ? undefined : record.role === 'content' ? 'content' : 'reference', label: optionalString(record, 'label', 160), alt: optionalString(record, 'alt', 240) };
}

function parseBinding(value: unknown): ElementSpec['binding'] | undefined {
  if (value === undefined) return undefined;
  const record = assertRecord(value, 'binding must be an object.');
  assertKeys(record, ['key', 'sourceLabel']);
  return { key: requiredString(record, 'key', 80), sourceLabel: optionalString(record, 'sourceLabel', 120) };
}

function parseElement(value: unknown, count: { value: number }): ElementSpec {
  const record = assertRecord(value, 'Every element must be an object.');
  assertKeys(record, ['type', 'name', 'x', 'y', 'width', 'height', 'rotation', 'content', 'style', 'layout', 'shape', 'image', 'hidden', 'locked', 'binding', 'children']);
  count.value += 1;
  if (count.value > 100) throw new Error('The element tree may contain at most 100 Layers.');
  const type = requiredString(record, 'type', 20) as ElementSpec['type'];
  if (!['frame', 'text', 'rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'image'].includes(type)) throw new Error('type must be frame, text, rectangle, ellipse, line, arrow, polygon, or image.');
  if (typeof record.width !== 'number' || typeof record.height !== 'number') throw new Error('Every element needs numeric width and height.');
  const children = record.children === undefined ? undefined : (() => {
    if (!Array.isArray(record.children) || record.children.length > 100) throw new Error('children must contain at most 100 Layers.');
    return record.children.map((child) => parseElement(child, count));
  })();
  return {
    type,
    name: optionalString(record, 'name'),
    x: record.x === undefined ? undefined : finiteNumber(record.x, 'x'),
    y: record.y === undefined ? undefined : finiteNumber(record.y, 'y'),
    width: finiteNumber(record.width, 'width', 1, 20000),
    height: finiteNumber(record.height, 'height', 1, 20000),
    rotation: record.rotation === undefined ? undefined : finiteNumber(record.rotation, 'rotation', -360, 360),
    content: exactContent(record, 'content'),
    style: record.style === undefined ? undefined : parseStyle(record.style),
    layout: record.layout === undefined ? undefined : parseLayout(record.layout),
    shape: record.shape === undefined ? undefined : parseShape(record.shape),
    image: record.image === undefined ? undefined : parseImage(record.image),
    hidden: record.hidden === undefined ? undefined : bool(record.hidden, 'hidden'),
    locked: record.locked === undefined ? undefined : bool(record.locked, 'locked'),
    binding: parseBinding(record.binding),
    children,
  };
}

function parseElements(value: unknown): ElementSpec[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('elements must contain between 1 and 100 Layers.');
  const count = { value: 0 };
  return value.map((item) => parseElement(item, count));
}

function parseSemanticTarget(value: unknown): SemanticTarget {
  const record = assertRecord(value, 'target must be an object.');
  assertKeys(record, ['fileId', 'fileName', 'frameId', 'frameName', 'name', 'type', 'content', 'bindingKey']);
  const type = record.type === undefined ? undefined : requiredString(record, 'type', 20);
  if (type !== undefined && !['frame', 'text', 'rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'image'].includes(type)) throw new Error('type must be frame, text, rectangle, ellipse, line, arrow, polygon, or image.');
  const target: SemanticTarget = {
    fileId: optionalString(record, 'fileId'),
    fileName: optionalString(record, 'fileName'),
    frameId: optionalString(record, 'frameId'),
    frameName: optionalString(record, 'frameName'),
    name: optionalString(record, 'name'),
    type: type as SemanticTarget['type'],
    content: exactContent(record, 'content'),
    bindingKey: optionalString(record, 'bindingKey', 80),
  };
  if (!target.frameId && !target.frameName && !target.name && target.content === undefined && !target.bindingKey) throw new Error('target needs frameId, frameName, name, content, or bindingKey.');
  return target;
}

function parsePatch(value: unknown): ElementPatch {
  const record = assertRecord(value, 'Each update must be an object.');
  assertKeys(record, ['id', 'target', 'name', 'x', 'y', 'width', 'height', 'rotation', 'content', 'style', 'layout', 'shape', 'image', 'parentId', 'hidden', 'locked']);
  const hasId = record.id !== undefined;
  const hasTarget = record.target !== undefined;
  if (hasId === hasTarget) throw new Error('Each update needs exactly one of id or target.');
  const base = {
    name: optionalString(record, 'name'),
    x: record.x === undefined ? undefined : finiteNumber(record.x, 'x'),
    y: record.y === undefined ? undefined : finiteNumber(record.y, 'y'),
    width: record.width === undefined ? undefined : finiteNumber(record.width, 'width', 1, 20000),
    height: record.height === undefined ? undefined : finiteNumber(record.height, 'height', 1, 20000),
    rotation: record.rotation === undefined ? undefined : finiteNumber(record.rotation, 'rotation', -360, 360),
    content: exactContent(record, 'content'),
    style: record.style === undefined ? undefined : parseStyle(record.style),
    layout: record.layout === undefined ? undefined : parseLayout(record.layout),
    shape: record.shape === undefined ? undefined : parseShape(record.shape),
    image: parseImagePatch(record.image),
    parentId: record.parentId === undefined ? undefined : record.parentId === null ? null : requiredString(record, 'parentId'),
    hidden: record.hidden === undefined ? undefined : bool(record.hidden, 'hidden'),
    locked: record.locked === undefined ? undefined : bool(record.locked, 'locked'),
  };
  return hasId ? { id: requiredString(record, 'id'), ...base } : { target: parseSemanticTarget(record.target), ...base };
}

function parseCreateFrame(input: unknown): CreateArtboardInput {
  const record = assertRecord(input);
  assertKeys(record, ['name', 'width', 'height', 'preset', 'position']);
  const preset = record.preset === undefined ? undefined : requiredString(record, 'preset', 40) as CreateArtboardInput['preset'];
  if (preset && !ensurePreset(preset)) throw new Error(`Unsupported Frame preset “${preset}”.`);
  const width = record.width === undefined ? undefined : finiteNumber(record.width, 'width', 1, 20000);
  const height = record.height === undefined ? undefined : finiteNumber(record.height, 'height', 1, 20000);
  if (!preset && (width === undefined || height === undefined)) throw new Error('Provide both width and height, or a supported Frame preset.');
  if (preset && (width !== undefined || height !== undefined)) throw new Error('Provide either preset or explicit width and height, not both.');
  return { name: requiredString(record, 'name'), width, height, preset, position: record.position === undefined ? undefined : parsePosition(record.position) };
}

function parseWriteFrame(input: unknown): WriteArtboardInput {
  const record = assertRecord(input);
  assertKeys(record, ['frameId', 'mode', 'elements', 'force']);
  const mode = requiredString(record, 'mode', 20);
  if (mode !== 'append' && mode !== 'replace') throw new Error('mode must be append or replace.');
  return { artboardId: requiredString(record, 'frameId'), mode, elements: parseElements(record.elements), force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseInsert(input: unknown): InsertElementsInput {
  const record = assertRecord(input);
  assertKeys(record, ['frameId', 'parentId', 'elements']);
  const targetCount = [record.frameId, record.parentId].filter((value) => value !== undefined).length;
  if (targetCount !== 1) throw new Error('Provide exactly one of frameId or parentId.');
  return { frameId: optionalString(record, 'frameId'), parentId: optionalString(record, 'parentId'), elements: parseElements(record.elements) };
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
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum || !value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120)) throw new Error(`${field} must contain between 1 and ${maximum} IDs.`);
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
    if (typeof item.value === 'string') return { key, value: item.value.slice(0, 6000) };
    const image = assertRecord(item.value, 'value must be a string or Asset object.');
    assertKeys(image, ['assetId', 'label', 'alt']);
    return { key, value: { assetId: requiredString(image, 'assetId'), label: optionalString(image, 'label', 160), alt: optionalString(image, 'alt', 240) } };
  });
  return { values, force: record.force === undefined ? false : bool(record.force, 'force') };
}

function parseBindings(input: unknown, document: DocumentModel): Array<{ nodeId: string; key: string; sourceLabel?: string }> {
  const record = assertRecord(input);
  assertKeys(record, ['bindings']);
  if (!Array.isArray(record.bindings) || record.bindings.length < 1 || record.bindings.length > 50) throw new Error('bindings must contain between 1 and 50 items.');
  return record.bindings.map((raw) => {
    const binding = assertRecord(raw);
    assertKeys(binding, ['nodeId', 'target', 'key', 'sourceLabel']);
    const nodeId = binding.nodeId === undefined ? resolveSemanticTarget(document, parseSemanticTarget(binding.target)) : requiredString(binding, 'nodeId');
    return { nodeId, key: requiredString(binding, 'key', 80), sourceLabel: optionalString(binding, 'sourceLabel', 120) };
  });
}

function parseFrameIds(input: unknown): string[] | undefined {
  const record = assertRecord(input);
  assertKeys(record, ['frameIds']);
  if (record.frameIds === undefined) return undefined;
  if (!Array.isArray(record.frameIds) || record.frameIds.length > 16 || !record.frameIds.every((id) => typeof id === 'string' && id.length > 0)) throw new Error('frameIds must contain at most 16 IDs.');
  return [...new Set(record.frameIds as string[])];
}

function parseExport(input: unknown): { frameIds: string[]; format: ExportFormat; scale: 1 | 2 } {
  const record = assertRecord(input);
  assertKeys(record, ['frameIds', 'format', 'scale']);
  const frameIds = parseIds(record, 'frameIds', 8);
  const format = requiredString(record, 'format', 10) as ExportFormat;
  if (!['png', 'svg', 'html', 'json'].includes(format)) throw new Error('format must be png, svg, html, or json.');
  const scale = record.scale === undefined ? 1 : Math.round(finiteNumber(record.scale, 'scale', 1, 2)) as 1 | 2;
  if (scale !== 1 && scale !== 2) throw new Error('scale must be 1 or 2.');
  return { frameIds, format, scale };
}

function parseFileTarget(input: unknown): { fileId?: string; fileName?: string } {
  const record = assertRecord(input);
  assertKeys(record, ['fileId', 'fileName']);
  const fileId = optionalString(record, 'fileId');
  const fileName = optionalString(record, 'fileName');
  if ((fileId === undefined) === (fileName === undefined)) throw new Error('Provide exactly one of fileId or fileName.');
  return { fileId, fileName };
}

function fileSummary(file: EaselFile): Record<string, unknown> {
  const frames = getArtboards(file.document).map((frame) => ({ id: frame.id, name: frame.name, type: 'frame', width: frame.width, height: frame.height, layerCount: getPageNodeIds(file.document, frame.pageId).filter((id) => getArtboardForNode(file.document, id)?.id === frame.id).length - 1 }));
  return { fileId: file.id, fileName: file.name, revision: file.document.revision, frameCount: frames.length, assetCount: Object.keys(file.document.assets).length, frames };
}

function currentFile(state: EditorState): EaselFile {
  return state.files.find((file) => file.id === state.activeFileId) ?? { id: state.activeFileId || state.document.id, name: state.document.name, document: state.document, updatedAt: state.document.updatedAt, open: true };
}

function normalizeType(type: DesignNode['type']): string {
  return type === 'artboard' ? 'frame' : type;
}

function nodeSummary(document: DocumentModel, node: DesignNode, maxTextChars: number, detail: 'compact' | 'full' = 'compact'): Record<string, unknown> {
  const frame = getArtboardForNode(document, node.id);
  const rect = getAbsoluteRect(document, node.id);
  const text = node.content === undefined ? undefined : node.content.length > maxTextChars ? `${node.content.slice(0, maxTextChars)}…` : node.content;
  const summary: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: normalizeType(node.type),
    parentId: node.parentId,
    frame: frame ? { id: frame.id, name: frame.name } : null,
    bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, rotation: rect.rotation },
    content: text,
    contentTruncated: node.content !== undefined && node.content.length > maxTextChars,
    bindingKey: node.binding?.key,
    hidden: node.hidden,
    locked: node.locked,
  };
  if (detail === 'full') {
    summary.childCount = node.childIds.length;
    summary.style = { ...node.style };
    summary.layout = node.layout;
    summary.shape = node.shape;
    summary.image = node.image ? { assetId: node.image.assetId, label: node.image.label, alt: node.image.alt, role: node.image.role } : undefined;
    summary.binding = node.binding ? { key: node.binding.key, sourceLabel: node.binding.sourceLabel, sharedValue: node.binding.sharedValue } : undefined;
  }
  return summary;
}

function assetSummary(asset: ImageAsset): Record<string, unknown> {
  return { assetId: asset.id, name: asset.originalName, source: asset.sourceLabel ?? 'Uploaded', type: 'image', dimensions: { width: asset.naturalWidth, height: asset.naturalHeight } };
}

const MAX_RESULT_CHARS = 2200;

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, Math.max(0, maximum - 1))}…` : value;
}

function shortValue(value: unknown): unknown {
  if (typeof value === 'string') return truncate(value, 220);
  if (Array.isArray(value)) return value.slice(0, 20).map(shortValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, child]) => [key, shortValue(child)]));
  return value;
}

function compactArrayItem(value: unknown, key: string): unknown {
  if (!isRecord(value)) return value;
  if (key === 'layers' || key === 'nodes' || key === 'changed') {
    return { id: value.id, name: value.name, type: value.type, frame: value.frame, bounds: value.bounds, content: value.content, values: value.values, bindingKey: value.bindingKey };
  }
  if (key === 'frames') return { id: value.id ?? value.frameId, name: value.name ?? value.frameName, type: 'frame', width: value.width, height: value.height, layerCount: value.layerCount };
  if (key === 'assets') return { assetId: value.assetId, name: value.name, source: value.source, type: value.type, dimensions: value.dimensions };
  if (key === 'files') return { fileName: value.fileName, frameId: value.frameId, frameName: value.frameName, bytes: value.bytes, width: value.width, height: value.height, unsupported: value.unsupported };
  return value;
}

function resultEnvelope(result: Record<string, unknown>, fallbackMessage: string): Record<string, unknown> {
  const state = result;
  const core = ['ok', 'action', 'message', 'revision', 'file', 'fileId', 'fileName', 'canvas', 'targetIds', 'totalMatches', 'offset', 'returnedCount', 'returnedLayerCount', 'nextOffset', 'truncated', 'resultTruncated', 'changedCount', 'limits', 'counts', 'selection', 'changed', 'changedIds', 'skippedIds', 'failedIds', 'createdIds', 'deletedIds', 'mappings', 'frame', 'frameId', 'frameName', 'frameIds', 'frames', 'layers', 'assets', 'asset', 'assetId', 'layerId', 'layerName', 'bounds', 'dimensions', 'source', 'format', 'scale', 'files', 'snapshotId', 'previewOpen', 'exportReady', 'unsupportedStyles', 'deduplicated', 'error'];
  return Object.fromEntries(core.filter((key) => state[key] !== undefined).map((key) => [key, state[key]]).concat(!state.message ? [['message', fallbackMessage]] : []));
}

function boundResult(result: Record<string, unknown>, fallbackMessage = 'Narrow the scope or lower the limits to inspect more detail.'): ToolResult {
  let candidate = resultEnvelope(result, fallbackMessage);
  if (JSON.stringify(candidate).length <= MAX_RESULT_CHARS) return candidate as ToolResult;
  candidate = Object.fromEntries(Object.entries(candidate).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.slice(0, 8).map((item) => compactArrayItem(item, key))];
    return [key, shortValue(value)];
  }));
  let serialized = JSON.stringify(candidate);
  if (serialized.length <= MAX_RESULT_CHARS) return { ...candidate, resultTruncated: true } as unknown as ToolResult;
  const minimal = resultEnvelope({ ...candidate, layers: Array.isArray(candidate.layers) ? candidate.layers.slice(0, 3) : undefined, frames: Array.isArray(candidate.frames) ? candidate.frames.slice(0, 4) : undefined, assets: Array.isArray(candidate.assets) ? candidate.assets.slice(0, 6) : undefined, changed: Array.isArray(candidate.changed) ? candidate.changed.slice(0, 3) : undefined }, fallbackMessage);
  serialized = JSON.stringify(minimal);
  if (serialized.length > MAX_RESULT_CHARS) {
    const reduced = resultEnvelope({ ...minimal, layers: undefined, frames: undefined, assets: undefined, changed: undefined, error: candidate.error }, fallbackMessage);
    return { ...reduced, resultTruncated: true } as unknown as ToolResult;
  }
  return { ...minimal, resultTruncated: true } as unknown as ToolResult;
}

function errorResult(error: unknown, code = 'INVALID_INPUT'): ToolResult {
  if (error instanceof CommandError) return boundResult({ ok: false, message: error.message, error: { code: error.code, message: error.message, affectedIds: error.affectedIds, details: error.details } });
  return boundResult({ ok: false, message: error instanceof Error ? error.message : 'The tool call could not be completed.', error: { code, message: error instanceof Error ? error.message : 'The tool call could not be completed.' } });
}

function mutationResult(state: EditorState, action: string): ToolResult {
  const last = state.lastAction;
  const file = currentFile(state);
  return boundResult({ ok: true, action, message: last?.label ?? action, revision: state.document.revision, file: fileSummary(file), fileId: file.id, fileName: file.name, changedIds: last?.changedIds ?? [], skippedIds: last?.skippedIds ?? [], failedIds: last?.failedIds ?? [], ...(last?.result ?? {}) });
}

function commitCommand(bridge: Bridge, command: Command, action: string): ToolResult {
  const before = bridge.getState();
  const outcome = tryDispatchCommand(before, command);
  if (outcome.error) return errorResult(outcome.error);
  if (outcome.state === before) return mutationResult(before, action);
  const next = syncActiveFile(outcome.state);
  bridge.commit(next);
  return mutationResult(next, action);
}

function resolveFrameId(document: DocumentModel, target: SemanticTarget): string {
  const candidates = Object.values(document.nodes).filter((node) => node.type === 'artboard' || node.type === 'frame').filter((node) => {
    if (target.frameId && node.id !== target.frameId) return false;
    if (target.frameName && node.name.trim().toLowerCase() !== target.frameName.trim().toLowerCase()) return false;
    if (!target.frameId && !target.frameName && target.name && node.name.trim().toLowerCase() !== target.name.trim().toLowerCase()) return false;
    if (target.type && target.type !== 'frame' && normalizeType(node.type) !== target.type) return false;
    return true;
  });
  if (candidates.length === 1) return candidates[0].id;
  const details = { target, matchCount: candidates.length, candidates: candidates.slice(0, 8).map((node) => ({ id: node.id, name: node.name, type: 'frame' })) };
  if (candidates.length > 1) throw new CommandError('AMBIGUOUS_TARGET', `The Frame target matched ${candidates.length} Frames. Add an exact frameId.`, candidates.map((node) => node.id), details);
  throw new CommandError('NOT_FOUND', 'No Frame matched the requested target.', [], details);
}

function assertExportFrameIds(document: DocumentModel, frameIds: string[]): void {
  const invalid = frameIds.filter((id) => document.nodes[id]?.type !== 'artboard');
  if (invalid.length) throw new CommandError('NOT_A_FRAME', 'Every requested export ID must reference an existing Frame.', invalid);
}

function targetFileFromInput(input: unknown): { fileId?: string; fileName?: string } | null {
  const record = isRecord(input) ? input : {};
  const targets: Array<{ fileId?: string; fileName?: string }> = [];
  if (typeof record.fileId === 'string') targets.push({ fileId: record.fileId });
  if (typeof record.fileName === 'string') targets.push({ fileName: record.fileName });
  if (Array.isArray(record.updates)) record.updates.forEach((raw) => { if (isRecord(raw) && isRecord(raw.target)) { const target = raw.target; if (typeof target.fileId === 'string') targets.push({ fileId: target.fileId }); if (typeof target.fileName === 'string') targets.push({ fileName: target.fileName }); } });
  if (Array.isArray(record.bindings)) record.bindings.forEach((raw) => { if (isRecord(raw) && isRecord(raw.target)) { const target = raw.target; if (typeof target.fileId === 'string') targets.push({ fileId: target.fileId }); if (typeof target.fileName === 'string') targets.push({ fileName: target.fileName }); } });
  if (isRecord(record.target)) { if (typeof record.target.fileId === 'string') targets.push({ fileId: record.target.fileId }); if (typeof record.target.fileName === 'string') targets.push({ fileName: record.target.fileName }); }
  if (!targets.length) return null;
  const keys = new Set(targets.map((target) => `${target.fileId ?? ''}|${target.fileName ?? ''}`));
  if (keys.size > 1) throw new Error('A single tool call may target only one File.');
  return targets[0];
}

async function switchFile(bridge: Bridge, target: { fileId?: string; fileName?: string }): Promise<Record<string, unknown>> {
  if (bridge.openFile) return bridge.openFile(target);
  const state = bridge.getState();
  const matches = state.files.filter((file) => target.fileId ? file.id === target.fileId : file.name.trim().toLowerCase() === target.fileName?.trim().toLowerCase());
  if (matches.length !== 1) throw new CommandError(matches.length ? 'AMBIGUOUS_FILE' : 'FILE_NOT_FOUND', matches.length ? 'More than one File has that name.' : 'No saved File matched that exact target.', matches.map((file) => file.id), { target, candidates: matches.slice(0, 8).map(fileSummary) });
  const file = matches[0];
  bridge.commit(syncActiveFile({ ...state, activeFileId: file.id, document: deepClone(file.document), history: [], future: [], lastAction: null, focus: null, preview: null }));
  return { ok: true, message: `Opened ${file.name}`, ...fileSummary(file) };
}

async function ensureInputFile(bridge: Bridge, input: unknown): Promise<void> {
  const target = targetFileFromInput(input);
  if (!target) return;
  const state = bridge.getState();
  if ((target.fileId && state.activeFileId === target.fileId) || (target.fileName && currentFile(state).name.trim().toLowerCase() === target.fileName.trim().toLowerCase())) return;
  await switchFile(bridge, target);
}

function parseOpenFile(input: unknown): { fileId?: string; fileName?: string } {
  return parseFileTarget(input);
}

function parseInspectAssets(input: unknown): { fileId?: string; fileName?: string; name?: string; source?: string; assetId?: string; maxAssets: number; offset: number } {
  const record = assertRecord(input);
  assertKeys(record, ['fileId', 'fileName', 'name', 'source', 'type', 'assetId', 'maxAssets', 'offset']);
  if (record.type !== undefined && record.type !== 'image') throw new Error('type must be image.');
  return { fileId: optionalString(record, 'fileId'), fileName: optionalString(record, 'fileName'), name: optionalString(record, 'name', 160), source: optionalString(record, 'source', 40), assetId: optionalString(record, 'assetId'), maxAssets: record.maxAssets === undefined ? 12 : Math.round(finiteNumber(record.maxAssets, 'maxAssets', 1, 40)), offset: record.offset === undefined ? 0 : Math.round(finiteNumber(record.offset, 'offset', 0, 100000)) };
}

function inspectAssets(state: EditorState, input: unknown): ToolResult {
  const filters = parseInspectAssets(input);
  const all = Object.values(state.document.assets).filter((asset) => (!filters.assetId || asset.id === filters.assetId) && (!filters.name || asset.originalName.trim().toLowerCase() === filters.name.trim().toLowerCase()) && (!filters.source || (asset.sourceLabel ?? 'Uploaded').trim().toLowerCase() === filters.source.trim().toLowerCase()));
  const assets = all.slice(filters.offset, filters.offset + filters.maxAssets).map(assetSummary);
  const nextOffset = filters.offset + assets.length < all.length ? filters.offset + assets.length : undefined;
  const file = currentFile(state);
  return boundResult({ ok: true, message: 'Asset inspection completed.', revision: state.document.revision, file: fileSummary(file), fileId: file.id, fileName: file.name, assets, totalMatches: all.length, offset: filters.offset, returnedCount: assets.length, nextOffset, truncated: nextOffset !== undefined, limits: { maxAssets: filters.maxAssets, offset: filters.offset } });
}

function inspectDocument(state: EditorState, input: unknown): ToolResult {
  const record = assertRecord(input);
  assertKeys(record, ['fileId', 'fileName', 'scope', 'frameId', 'frameName', 'nodeIds', 'name', 'type', 'content', 'bindingKey', 'maxFrames', 'maxLayers', 'maxTextChars', 'offset', 'detail']);
  const scope = record.scope === undefined ? 'file' : requiredString(record, 'scope', 20);
  if (!['file', 'frame', 'selection'].includes(scope)) throw new Error('scope must be file, frame, or selection.');
  const maxFrames = record.maxFrames === undefined ? 4 : Math.round(finiteNumber(record.maxFrames, 'maxFrames', 1, 8));
  const maxLayers = record.maxLayers === undefined ? 20 : Math.round(finiteNumber(record.maxLayers, 'maxLayers', 1, 80));
  const maxTextChars = record.maxTextChars === undefined ? 180 : Math.round(finiteNumber(record.maxTextChars, 'maxTextChars', 20, 600));
  const offset = record.offset === undefined ? 0 : Math.round(finiteNumber(record.offset, 'offset', 0, 100000));
  const detail = record.detail === 'full' ? 'full' : 'compact';
  const frameId = optionalString(record, 'frameId');
  const frameName = optionalString(record, 'frameName');
  const name = optionalString(record, 'name');
  const content = exactContent(record, 'content');
  const bindingKey = optionalString(record, 'bindingKey', 80);
  let scopedIds: string[];
  if (scope === 'selection') scopedIds = state.document.selection.ids;
  else if (scope === 'frame') {
    const resolvedFrame = resolveFrameId(state.document, { frameId, frameName, name });
    scopedIds = getDescendantIds(state.document, resolvedFrame);
  } else scopedIds = getPageNodeIds(state.document);
  const target: SemanticTarget = { frameId, frameName, name, type: record.type === undefined ? undefined : requiredString(record, 'type', 20) as SemanticTarget['type'], content, bindingKey };
  const requestedIds = Array.isArray(record.nodeIds) ? record.nodeIds.filter((id): id is string => typeof id === 'string') : undefined;
  const candidates = (requestedIds ? requestedIds.filter((id) => scopedIds.includes(id)) : scopedIds).map((id) => state.document.nodes[id]).filter((node): node is DesignNode => Boolean(node));
  const filtered = candidates.filter((node) => matchesSemanticTarget(state.document, node, target));
  const layers = filtered.slice(offset, offset + maxLayers).map((node) => nodeSummary(state.document, node, maxTextChars, detail));
  const nextOffset = offset + layers.length < filtered.length ? offset + layers.length : undefined;
  const file = currentFile(state);
  const frames = getArtboards(state.document).slice(0, maxFrames).map((frame) => ({ id: frame.id, name: frame.name, type: 'frame', width: frame.width, height: frame.height, layerCount: getPageNodeIds(state.document, frame.pageId).filter((id) => getArtboardForNode(state.document, id)?.id === frame.id).length - 1 }));
  return boundResult({ ok: true, message: 'File inspection completed.', revision: state.document.revision, file: fileSummary(file), fileId: file.id, fileName: file.name, canvas: { id: 'canvas', name: 'Canvas' }, frames, layers, selection: state.document.selection, totalMatches: filtered.length, offset, returnedCount: layers.length, returnedLayerCount: layers.length, nextOffset, limits: { maxFrames, maxLayers, maxTextChars, offset, detail }, truncated: nextOffset !== undefined });
}

function supportedMime(mimeType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(mimeType);
}

function inferSvgSize(dataUrl: string): { width: number; height: number } | null {
  try {
    const raw = decodeURIComponent(dataUrl.split(',').slice(1).join(','));
    const width = Number(raw.match(/\bwidth=["']([\d.]+)/i)?.[1]);
    const height = Number(raw.match(/\bheight=["']([\d.]+)/i)?.[1]);
    if (width > 0 && height > 0) return { width, height };
    const viewBox = raw.match(/viewBox=["'][^"']*?([\d.]+)[\s,]+([\d.]+)["']/i);
    if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  } catch {
    return null;
  }
  return null;
}

async function imageDimensions(dataUrl: string, mimeType: string): Promise<{ width: number; height: number }> {
  if (mimeType === 'image/svg+xml') return inferSvgSize(dataUrl) ?? { width: 720, height: 520 };
  if (typeof Image === 'undefined') return { width: 720, height: 520 };
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 720, height: image.naturalHeight || image.height || 520 });
    image.onerror = () => resolve({ width: 720, height: 520 });
    image.src = dataUrl;
  });
}

function toDataUrl(data: string, mimeType: string): string {
  if (data.startsWith('data:')) {
    const header = data.slice(0, data.indexOf(',')).toLowerCase();
    if (!header.startsWith(`data:${mimeType.toLowerCase()}`)) throw new Error('The data URL MIME type does not match mimeType.');
    return data;
  }
  if (!/^[a-z0-9+/=\r\n]+$/i.test(data)) throw new Error('data must be a base64 string or data URL.');
  return `data:${mimeType};base64,${data.replace(/\s/g, '')}`;
}

async function parseImportedAsset(input: unknown): Promise<{ asset: ImageAsset; target: SemanticTarget; position: { x: number; y: number }; width?: number; height?: number; name?: string; alt?: string }> {
  const record = assertRecord(input);
  assertKeys(record, ['data', 'filename', 'mimeType', 'source', 'target', 'position', 'width', 'height', 'name', 'alt']);
  const mimeType = requiredString(record, 'mimeType', 40).toLowerCase();
  if (!supportedMime(mimeType)) throw new Error('mimeType must be a supported image MIME type.');
  const data = requiredString(record, 'data', 1500000);
  if (data.length > 1500000) throw new Error('Image data must be smaller than 1.5 MB.');
  const dataUrl = toDataUrl(data, mimeType);
  const dimensions = await imageDimensions(dataUrl, mimeType);
  const asset: ImageAsset = { id: createId('asset'), dataUrl, originalName: requiredString(record, 'filename', 160), naturalWidth: dimensions.width, naturalHeight: dimensions.height, aspectRatio: dimensions.width / dimensions.height, palette: [], sourceLabel: optionalString(record, 'source', 40) ?? 'Drive', createdAt: new Date().toISOString() };
  return { asset, target: parseSemanticTarget(record.target), position: parsePosition(record.position), width: record.width === undefined ? undefined : finiteNumber(record.width, 'width', 1, 12000), height: record.height === undefined ? undefined : finiteNumber(record.height, 'height', 1, 12000), name: optionalString(record, 'name'), alt: optionalString(record, 'alt', 240) };
}

function parseFocus(input: unknown): string[] {
  const record = assertRecord(input);
  assertKeys(record, ['ids']);
  return parseIds(record, 'ids', 8);
}

const MUTATING_TOOLS = new Set(['create_frame', 'write_frame', 'insert_elements', 'update_elements', 'duplicate_elements', 'delete_elements', 'bind_context_fields', 'apply_context_values', 'import_and_place_asset']);

function feedbackTargetIds(state: EditorState, name: string, input: unknown): string[] {
  const ids = new Set<string>();
  const add = (id: unknown) => {
    if (typeof id !== 'string') return;
    const node = state.document.nodes[id];
    if (!node) return;
    ids.add(node.id);
    const frame = getArtboardForNode(state.document, node.id);
    if (frame) ids.add(frame.id);
  };
  const record = isRecord(input) ? input : {};
  if (name === 'focus_for_inspection' || name === 'duplicate_elements' || name === 'delete_elements') {
    if (Array.isArray(record.ids)) record.ids.forEach(add);
  } else if (name === 'capture_frame' || name === 'write_frame') {
    add(record.frameId);
  } else if (name === 'insert_elements') {
    add(record.frameId);
    add(record.parentId);
  } else if (name === 'update_elements' || name === 'bind_context_fields') {
    const candidates = name === 'update_elements' ? record.updates : record.bindings;
    if (Array.isArray(candidates)) candidates.forEach((raw) => {
      if (!isRecord(raw)) return;
      add(raw.id ?? raw.nodeId);
      if (isRecord(raw.target)) {
        try { add(resolveSemanticTarget(state.document, parseSemanticTarget(raw.target))); } catch { /* The command returns the useful target error. */ }
      }
    });
  } else if (name === 'apply_context_values') {
    const keys = new Set(Array.isArray(record.values) ? record.values.filter(isRecord).map((item) => item.key).filter((key): key is string => typeof key === 'string') : []);
    Object.values(state.document.nodes).filter((node) => node.binding && keys.has(node.binding.key)).forEach((node) => add(node.id));
  } else if (name === 'import_and_place_asset' && isRecord(record.target)) {
    try { add(resolveFrameId(state.document, parseSemanticTarget(record.target))); } catch { /* The command reports the target issue. */ }
  } else if (name === 'create_frame') {
    add(state.document.selection.primaryId ?? getArtboards(state.document)[0]?.id);
  } else if (name === 'export_frames') {
    if (Array.isArray(record.frameIds)) record.frameIds.forEach(add);
  }
  return [...ids];
}

export function createToolBridge(bridge: Bridge): { invoke: (name: string, input: unknown, signal?: AbortSignal) => Promise<ToolResult>; definitions: ToolDefinition[] } {
  const invoke = async (name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult> => {
    let result: ToolResult = { ok: false, message: 'The tool call could not be completed.' };
    let feedbackToken: string | undefined;
    let feedbackTargets: string[] = [];
    try {
      if (name !== 'open_file') await ensureInputFile(bridge, input);
      ensureNotAborted(signal);
      let state = bridge.getState();
      feedbackTargets = feedbackTargetIds(state, name, input);
      feedbackToken = MUTATING_TOOLS.has(name) ? bridge.beginAgentWork?.(feedbackTargets) : undefined;
      switch (name) {
        case 'inspect_document': result = inspectDocument(state, input); break;
        case 'open_file': {
          const opened = await switchFile(bridge, parseOpenFile(input));
          result = boundResult({ ...opened, file: opened.fileId ? fileSummary(bridge.getState().files.find((file) => file.id === opened.fileId) ?? currentFile(bridge.getState())) : undefined });
          break;
        }
        case 'inspect_assets': result = inspectAssets(state, input); break;
        case 'focus_for_inspection': {
          const ids = parseFocus(input);
          state = bridge.getState();
          if (ids.some((id) => !state.document.nodes[id])) throw new Error('Every focus ID must reference an existing Layer or Frame.');
          const focused = await bridge.focus(ids);
          result = boundResult({ ok: focused.ok, message: focused.message, targetIds: focused.targetIds, viewport: focused.viewport, previewOpen: false, file: fileSummary(currentFile(bridge.getState())) });
          break;
        }
        case 'capture_frame': {
          const record = assertRecord(input);
          assertKeys(record, ['frameId', 'scale']);
          const frameId = requiredString(record, 'frameId');
          const node = getNode(state.document, frameId);
          if (!node || node.type !== 'artboard') throw new Error(`No Frame has the ID “${frameId}”.`);
          const scale = record.scale === undefined ? 1 : Math.round(finiteNumber(record.scale, 'scale', 1, 2)) as 1 | 2;
          if (scale !== 1 && scale !== 2) throw new Error('scale must be 1 or 2.');
          result = boundResult({ ...(await bridge.capture(frameId, scale, signal)), file: fileSummary(currentFile(bridge.getState())), fileId: bridge.getState().activeFileId, fileName: currentFile(bridge.getState()).name, frame: { id: frameId, name: node.name, type: 'frame' }, frameName: node.name });
          break;
        }
        case 'create_frame': result = commitCommand(bridge, { type: 'create-artboard', ...parseCreateFrame(input), source: 'agent' }, name); break;
        case 'write_frame': result = commitCommand(bridge, { type: 'write-artboard', ...parseWriteFrame(input), source: 'agent' }, name); break;
        case 'insert_elements': result = commitCommand(bridge, { type: 'insert-elements', ...parseInsert(input), source: 'agent' }, name); break;
        case 'update_elements': result = commitCommand(bridge, { type: 'update-elements', ...parseUpdate(input), source: 'agent' }, name); break;
        case 'duplicate_elements': result = commitCommand(bridge, { type: 'duplicate-elements', ...parseDuplicate(input), source: 'agent' }, name); break;
        case 'delete_elements': result = commitCommand(bridge, { type: 'delete-elements', ...parseDelete(input), source: 'agent' }, name); break;
        case 'bind_context_fields': result = commitCommand(bridge, { type: 'bind-context', bindings: parseBindings(input, state.document), source: 'agent' }, name); break;
        case 'apply_context_values': result = commitCommand(bridge, { type: 'apply-context', ...parseContextApply(input), source: 'agent' }, name); break;
        case 'import_and_place_asset': {
          const parsed = await parseImportedAsset(input);
          const frameId = resolveFrameId(state.document, parsed.target);
          const command: Command = { type: 'place-asset', asset: parsed.asset, frameId, position: parsed.position, width: parsed.width, height: parsed.height, name: parsed.name, alt: parsed.alt, source: 'agent' } satisfies Command;
          result = commitCommand(bridge, command, name);
          break;
        }
        case 'validate_document': {
          const frameIds = parseFrameIds(input);
          if (frameIds?.length) assertExportFrameIds(state.document, frameIds);
          const file = currentFile(state);
          result = boundResult({ ok: true, message: 'Validation completed.', file: fileSummary(file), fileId: file.id, fileName: file.name, ...validateDocumentModel(state.document, state.lastAction, frameIds ? { artboardIds: frameIds } : {}) });
          break;
        }
        case 'export_frames': {
          const parsed = parseExport(input);
          assertExportFrameIds(state.document, parsed.frameIds);
          ensureNotAborted(signal);
          const exported = await bridge.export(parsed.frameIds, parsed.format, parsed.scale, signal);
          result = boundResult({ ...exported, file: fileSummary(currentFile(bridge.getState())), fileId: bridge.getState().activeFileId, fileName: currentFile(bridge.getState()).name, frameIds: parsed.frameIds });
          break;
        }
        default: result = errorResult(new Error(`Unknown Site Tool “${name}”.`), 'UNKNOWN_TOOL');
      }
    } catch (error) {
      result = errorResult(error);
    } finally {
      if (feedbackToken) {
        const changedIds = Array.isArray(result.changedIds) ? result.changedIds : [];
        const targetIds = Array.isArray(result.targetIds) ? result.targetIds : [];
        const createdIds = Array.isArray(result.createdIds) ? result.createdIds : [];
        const allIds = [...new Set([...feedbackTargets, ...changedIds, ...targetIds, ...createdIds].filter((id): id is string => typeof id === 'string'))];
        bridge.completeAgentWork?.(feedbackToken, allIds, result.ok === true, MUTATING_TOOLS.has(name));
        if (result.ok === true && changedIds.length) bridge.reveal?.(changedIds);
      }
    }
    return result;
  };
  return { invoke, definitions: TOOL_DEFINITIONS };
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('The tool call was cancelled.');
}

export async function registerWebMCPTools(bridge: Bridge): Promise<{ supported: boolean; registered: boolean; cleanup: () => void; error?: string }> {
  const context = typeof document !== 'undefined' ? document.modelContext : undefined;
  if (!context || typeof context.registerTool !== 'function') return { supported: false, registered: false, cleanup: () => undefined };
  const controller = new AbortController();
  const toolBridge = createToolBridge(bridge);
  try {
    for (const definition of toolBridge.definitions) {
      await context.registerTool({ ...definition, execute: async (input: unknown, meta?: { signal?: AbortSignal }) => toolBridge.invoke(definition.name, input, meta?.signal) }, { signal: controller.signal });
    }
    return { supported: true, registered: true, cleanup: () => controller.abort() };
  } catch (error) {
    controller.abort();
    return { supported: true, registered: false, cleanup: () => undefined, error: error instanceof Error ? error.message : 'Site Tool registration failed.' };
  }
}

function schemaIsStrict(schema: unknown): boolean {
  if (!isRecord(schema)) return true;
  if (schema.type === 'object' && schema.additionalProperties !== false) return false;
  return Object.values(schema).every((value) => Array.isArray(value) ? value.every(schemaIsStrict) : schemaIsStrict(value));
}

export function toolSchemasAreStrict(): boolean {
  return TOOL_DEFINITIONS.every((definition) => schemaIsStrict(definition.inputSchema));
}
