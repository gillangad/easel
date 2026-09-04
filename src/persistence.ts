import { createInitialDocument, createInitialState, deepClone, materializeDocumentLayout, normalizePanels, nowIso, syncActiveFile } from './model';
import { replaceDocumentState } from './commands';
import type { DocumentModel, EaselFile, EditorState, PanelsState, ThemeMode } from './types';

const DB_NAME = 'easel-storage';
const STORE_NAME = 'documents';
const RECORD_ID = 'current';
const FALLBACK_KEY = 'easel-current-document';
const FILE_INDEX_KEY = 'easel-files-index';
const FILE_KEY_PREFIX = 'easel-file-';

type PersistedPayload = {
  version: 2;
  activeFileId: string;
  files: EaselFile[];
  theme: ThemeMode;
  panels: PanelsState;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function removeNodeTree(document: DocumentModel, id: string): void {
  const node = document.nodes[id];
  if (!node) return;
  [...node.childIds].forEach((childId) => removeNodeTree(document, childId));
  if (node.parentId) {
    const parent = document.nodes[node.parentId];
    if (parent) parent.childIds = parent.childIds.filter((childId) => childId !== id);
  }
  delete document.nodes[id];
}

function removeDefaultWebsiteTitleDuplicates(document: DocumentModel): void {
  const website = document.nodes.artboard_website;
  const primary = document.nodes.site_title;
  if (!website || !primary || website.type !== 'artboard' || primary.type !== 'text' || primary.parentId !== website.id || primary.name !== 'Website Title' || primary.content !== 'After Hours Book Club') return;
  const normalizedTitle = (primary.content ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  Object.values(document.nodes)
    .filter((node) => node.id !== primary.id && node.type === 'text' && node.pageId === primary.pageId && node.parentId === primary.parentId && (node.content ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === normalizedTitle)
    .map((node) => node.id)
    .forEach((id) => removeNodeTree(document, id));
}

function normalizeDocument(value: DocumentModel): DocumentModel {
  const document = deepClone(value);
  document.selection.ids = document.selection.ids.filter((id) => Boolean(document.nodes[id]));
  document.selection.primaryId = document.selection.ids.includes(document.selection.primaryId ?? '') ? document.selection.primaryId : document.selection.ids[document.selection.ids.length - 1] ?? null;
  Object.values(document.nodes).forEach((node) => {
    node.style = {
      fill: node.style?.fill ?? (node.type === 'text' ? 'transparent' : '#deded9'),
      opacity: typeof node.style?.opacity === 'number' ? node.style.opacity : 1,
      borderColor: node.style?.borderColor ?? 'transparent',
      borderWidth: typeof node.style?.borderWidth === 'number' ? node.style.borderWidth : 0,
      borderStyle: node.style?.borderStyle === 'dashed' || node.style?.borderStyle === 'dotted' ? node.style.borderStyle : 'solid',
      borderRadius: typeof node.style?.borderRadius === 'number' ? node.style.borderRadius : 0,
      color: node.style?.color ?? '#171717',
      fontFamily: node.style?.fontFamily ?? 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: typeof node.style?.fontSize === 'number' ? node.style.fontSize : 16,
      fontWeight: node.style?.fontWeight ?? 400,
      lineHeight: typeof node.style?.lineHeight === 'number' ? node.style.lineHeight : 1.4,
      letterSpacing: typeof node.style?.letterSpacing === 'number' ? node.style.letterSpacing : 0,
      textAlign: node.style?.textAlign ?? 'left',
    };
    if (node.layout) {
      node.layout = {
        mode: node.layout.mode === 'flex-row' || node.layout.mode === 'flex-column' ? node.layout.mode : 'free',
        gap: typeof node.layout.gap === 'number' && Number.isFinite(node.layout.gap) ? Math.max(0, node.layout.gap) : 16,
        padding: typeof node.layout.padding === 'number' && Number.isFinite(node.layout.padding) ? Math.max(0, node.layout.padding) : 24,
        alignItems: node.layout.alignItems === 'center' || node.layout.alignItems === 'end' || node.layout.alignItems === 'stretch' ? node.layout.alignItems : 'start',
        justifyContent: node.layout.justifyContent === 'center' || node.layout.justifyContent === 'end' || node.layout.justifyContent === 'space-between' ? node.layout.justifyContent : 'start',
        clipContent: node.layout.clipContent === true,
        wrap: node.layout.wrap === true,
      };
    }
    if (node.sizing) {
      node.sizing = {
        width: node.sizing.width === 'hug' || node.sizing.width === 'fill' ? node.sizing.width : 'fixed',
        height: node.sizing.height === 'hug' || node.sizing.height === 'fill' ? node.sizing.height : 'fixed',
      };
    }
    node.annotations = Array.isArray(node.annotations)
      ? node.annotations.filter((annotation): annotation is NonNullable<typeof node.annotations>[number] => isRecord(annotation) && typeof annotation.id === 'string' && typeof annotation.text === 'string' && typeof annotation.resolved === 'boolean').map((annotation) => ({ id: annotation.id, text: annotation.text.slice(0, 6000), resolved: annotation.resolved }))
      : [];
    if (node.type === 'polygon' && (!node.shape || !Number.isFinite(node.shape.sides))) node.shape = { sides: 6 };
    node.childIds = Array.isArray(node.childIds) ? node.childIds.filter((id) => Boolean(document.nodes[id])) : [];
  });
  removeDefaultWebsiteTitleDuplicates(document);
  document.selection.ids = document.selection.ids.filter((id) => Boolean(document.nodes[id]));
  document.selection.primaryId = document.selection.ids.includes(document.selection.primaryId ?? '') ? document.selection.primaryId : document.selection.ids[document.selection.ids.length - 1] ?? null;
  materializeDocumentLayout(document);
  Object.values(document.assets).forEach((asset) => {
    asset.sourceLabel = asset.sourceLabel || 'Uploaded';
  });
  document.updatedAt = document.updatedAt || nowIso();
  return document;
}

function validDocument(value: unknown): value is DocumentModel {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.pages) || !isRecord(value.nodes) || !isRecord(value.assets)) return false;
  if (typeof value.activePageId !== 'string' || !isRecord(value.selection) || !isRecord(value.viewport)) return false;
  if (typeof value.revision !== 'number') return false;
  const pageIds = new Set(value.pages.map((page) => isRecord(page) && typeof page.id === 'string' ? page.id : ''));
  if (!pageIds.has(value.activePageId)) return false;
  const validTypes = new Set(['artboard', 'frame', 'text', 'rectangle', 'ellipse', 'line', 'arrow', 'polygon', 'image']);
  return Object.values(value.nodes).every((node) => isRecord(node) && typeof node.id === 'string' && validTypes.has(String(node.type)) && typeof node.pageId === 'string' && pageIds.has(node.pageId));
}

function isLegacySeed(document: DocumentModel): boolean {
  const isOldLaunchSeed = document.id === 'document_easel'
    && document.revision <= 1
    && document.pages[0]?.name === 'Launch set'
    && document.nodes.site_title?.name === 'Event title'
    && Boolean(document.nodes.site_title?.content?.includes('Make room'))
    && !document.nodes.site_tagline;
  const isOldDarkBookClubSeed = document.id === 'document_easel'
    && document.revision <= 1
    && document.name === 'Book Club'
    && document.pages[0]?.name === 'Canvas'
    && document.nodes.website_background?.style?.fill === '#3b251c'
    && document.nodes.graphic_background?.style?.fill === '#3b251c'
    && document.nodes.site_title?.name === 'Website Title'
    && document.nodes.site_title?.content === 'After Hours Book Club'
    && document.nodes.graphic_title?.content === 'Quiet books. Good company.'
    && Object.keys(document.assets).length === 0;
  const isOldLightBookClubSeed = document.id === 'document_easel'
    && document.revision <= 1
    && document.name === 'Book Club'
    && document.pages[0]?.name === 'Canvas'
    && document.nodes.website_background?.style?.fill === '#fbfaf7'
    && document.nodes.graphic_background?.style?.fill === '#e7e1d6'
    && document.nodes.site_title?.name === 'Website Title'
    && document.nodes.site_title?.content === 'Make room for\nmore ideas.'
    && document.nodes.graphic_title?.content === 'Make room\nfor new ideas.'
    && document.nodes.graphic_tagline?.content === 'Leave with a clearer next step.'
    && Object.keys(document.assets).length === 0;
  return isOldLaunchSeed || isOldDarkBookClubSeed || isOldLightBookClubSeed;
}

function migrateDocument(document: DocumentModel): DocumentModel {
  return isLegacySeed(document) ? createInitialDocument() : normalizeDocument(document);
}

function fileRecord(document: DocumentModel, id = document.id, name = document.name, updatedAt = document.updatedAt, open = true): EaselFile {
  const legacySeed = isLegacySeed(document);
  const migrated = migrateDocument(document);
  return { id, name: legacySeed ? migrated.name : name || migrated.name, document: migrated, updatedAt: updatedAt || migrated.updatedAt, open };
}

function payloadFromState(state: EditorState): PersistedPayload {
  const normalized = syncActiveFile(state);
  return {
    version: 2,
    activeFileId: normalized.activeFileId,
    files: normalized.files.map((file) => fileRecord(file.document, file.id, file.name, file.updatedAt, file.open)),
    theme: normalized.theme,
    panels: deepClone(normalized.panels),
  };
}

function payloadFromUnknown(value: unknown): PersistedPayload | null {
  if (!isRecord(value)) return null;
  const theme: ThemeMode = value.theme === 'dark' ? 'dark' : 'light';
  const panels = normalizePanels(value.panels);
  if (Array.isArray(value.files)) {
    const files = value.files.filter((candidate): candidate is Record<string, unknown> => isRecord(candidate) && validDocument(candidate.document))
      .map((candidate) => fileRecord(candidate.document as DocumentModel, typeof candidate.id === 'string' ? candidate.id : undefined, typeof candidate.name === 'string' ? candidate.name : undefined, typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined, candidate.open !== false));
    if (files.length) {
      const activeFileId = typeof value.activeFileId === 'string' && files.some((file) => file.id === value.activeFileId) ? value.activeFileId : files[0].id;
      return { version: 2, activeFileId, files, theme, panels };
    }
  }
  if (isRecord(value.file) && validDocument(value.file.document)) {
    const file = value.file as Record<string, unknown>;
    const document = value.file.document as DocumentModel;
    const migrated = migrateDocument(document);
    return { version: 2, activeFileId: typeof file.id === 'string' ? file.id : migrated.id, files: [fileRecord(document, typeof file.id === 'string' ? file.id : undefined, typeof file.name === 'string' ? file.name : undefined, typeof file.updatedAt === 'string' ? file.updatedAt : undefined, file.open !== false)], theme, panels };
  }
  if (validDocument(value.document)) {
    const document = migrateDocument(value.document);
    return { version: 2, activeFileId: document.id, files: [fileRecord(document)], theme, panels };
  }
  if (validDocument(value)) {
    const document = migrateDocument(value);
    return { version: 2, activeFileId: document.id, files: [fileRecord(document)], theme, panels };
  }
  return null;
}

function stateFromPayload(payload: PersistedPayload): EditorState {
  const base = createInitialState();
  const files = payload.files.map((file) => fileRecord(file.document, file.id, file.name, file.updatedAt, file.open));
  const active = files.find((file) => file.id === payload.activeFileId) ?? files[0];
  return syncActiveFile({
    ...base,
    document: deepClone(active.document),
    files,
    activeFileId: active.id,
    theme: payload.theme,
    panels: normalizePanels(payload.panels),
  });
}

export function serializeDocument(document: DocumentModel): string {
  return JSON.stringify({ version: 1, document: deepClone(document) });
}

export function deserializeDocument(raw: string): DocumentModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const candidate = isRecord(parsed) && 'document' in parsed ? parsed.document : parsed;
  if (!validDocument(candidate)) throw new Error('The JSON does not contain a valid Easel document.');
  const document = normalizeDocument(candidate);
  document.updatedAt = nowIso();
  return document;
}

export function serializeEditorState(state: EditorState): string {
  return JSON.stringify(payloadFromState(state));
}

export function deserializeEditorState(raw: string): EditorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Saved Easel state is not valid JSON.');
  }
  const payload = payloadFromUnknown(parsed);
  if (!payload) throw new Error('Saved Easel state is missing a valid File.');
  return stateFromPayload(payload);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open document storage.'));
  });
}

async function indexedRead(): Promise<PersistedPayload | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_ID);
    request.onsuccess = () => {
      const record = request.result as { id: string; payload?: unknown } | undefined;
      resolve(payloadFromUnknown(record?.payload));
    };
    request.onerror = () => reject(request.error ?? new Error('Could not read document storage.'));
  });
}

async function indexedWrite(payload: PersistedPayload): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ id: RECORD_ID, payload });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not save document storage.'));
  });
}

function localStorageRead(): PersistedPayload | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const combined = localStorage.getItem(FALLBACK_KEY);
    const combinedPayload = combined ? payloadFromUnknown(JSON.parse(combined)) : null;
    if (combinedPayload) return combinedPayload;
    const indexRaw = localStorage.getItem(FILE_INDEX_KEY);
    if (!indexRaw) return null;
    const index = JSON.parse(indexRaw) as { activeFileId?: string; theme?: ThemeMode; panels?: unknown; fileIds?: unknown };
    const fileIds = Array.isArray(index.fileIds) ? index.fileIds.filter((id): id is string => typeof id === 'string') : [];
    const files = fileIds.map((id) => {
      const raw = localStorage.getItem(`${FILE_KEY_PREFIX}${encodeURIComponent(id)}`);
      if (!raw) return null;
      try {
        return payloadFromUnknown(JSON.parse(raw))?.files[0] ?? null;
      } catch {
        return null;
      }
    }).filter((file): file is EaselFile => Boolean(file));
    if (!files.length) return null;
    const activeFileId = typeof index.activeFileId === 'string' && files.some((file) => file.id === index.activeFileId) ? index.activeFileId : files[0].id;
    return { version: 2, activeFileId, files, theme: index.theme === 'dark' ? 'dark' : 'light', panels: normalizePanels(index.panels) };
  } catch {
    return null;
  }
}

function localStorageWrite(payload: PersistedPayload): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    localStorage.setItem(FILE_INDEX_KEY, JSON.stringify({ version: 2, activeFileId: payload.activeFileId, fileIds: payload.files.map((file) => file.id), theme: payload.theme, panels: payload.panels }));
    payload.files.forEach((file) => localStorage.setItem(`${FILE_KEY_PREFIX}${encodeURIComponent(file.id)}`, JSON.stringify({ version: 2, file })));
  } catch {
    // Persistence is best-effort; the current in-memory Files remain usable.
  }
}

export async function loadEditorState(): Promise<EditorState> {
  let indexed: PersistedPayload | null = null;
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  try {
    indexed = await Promise.race([
      indexedRead(),
      new Promise<null>((resolve) => { timeout = globalThis.setTimeout(() => resolve(null), 1200); }),
    ]);
  } catch {
    // Continue to the local-storage fallback.
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
  }
  if (indexed) return stateFromPayload(indexed);
  const local = localStorageRead();
  if (local) return stateFromPayload(local);
  return createInitialState();
}

export async function saveEditorState(state: EditorState): Promise<void> {
  const payload = payloadFromState(state);
  localStorageWrite(payload);
  try {
    await indexedWrite(payload);
  } catch {
    // The local-storage records are the bounded fallback for browsers without IndexedDB.
  }
}

export function importDocumentIntoState(state: EditorState, raw: string): EditorState {
  return syncActiveFile(replaceDocumentState(state, deserializeDocument(raw)));
}
