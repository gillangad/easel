import { createInitialState, deepClone, nowIso } from './model';
import { replaceDocumentState } from './commands';
import type { DocumentModel, EditorState, PanelsState, ThemeMode } from './types';

const DB_NAME = 'easel-storage';
const STORE_NAME = 'documents';
const RECORD_ID = 'current';
const FALLBACK_KEY = 'easel-current-document';

type PersistedPayload = {
  document: DocumentModel;
  theme: ThemeMode;
  panels: PanelsState;
};

function payloadFromState(state: EditorState): PersistedPayload {
  return { document: deepClone(state.document), theme: state.theme, panels: deepClone(state.panels) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validDocument(value: unknown): value is DocumentModel {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || !Array.isArray(value.pages) || !isRecord(value.nodes) || !isRecord(value.assets)) return false;
  if (typeof value.activePageId !== 'string' || !isRecord(value.selection) || !isRecord(value.viewport)) return false;
  if (typeof value.revision !== 'number') return false;
  const pageIds = new Set(value.pages.map((page) => isRecord(page) && typeof page.id === 'string' ? page.id : ''));
  if (!pageIds.has(value.activePageId)) return false;
  const validTypes = new Set(['artboard', 'frame', 'text', 'rectangle', 'image']);
  return Object.values(value.nodes).every((node) => isRecord(node) && typeof node.id === 'string' && validTypes.has(String(node.type)) && typeof node.pageId === 'string' && pageIds.has(node.pageId));
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
  const document = deepClone(candidate);
  document.updatedAt = nowIso();
  document.selection.ids = document.selection.ids.filter((id) => Boolean(document.nodes[id]));
  document.selection.primaryId = document.selection.ids.includes(document.selection.primaryId ?? '') ? document.selection.primaryId : document.selection.ids[document.selection.ids.length - 1] ?? null;
  return document;
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
      const record = request.result as { id: string; payload?: PersistedPayload } | undefined;
      resolve(record?.payload && validDocument(record.payload.document) ? record.payload : null);
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

export async function loadEditorState(): Promise<EditorState> {
  try {
    const indexed = await indexedRead();
    if (indexed) {
      const base = createInitialState();
      return { ...base, document: indexed.document, theme: indexed.theme, panels: indexed.panels };
    }
  } catch {
    // The fallback is intentionally local and limited to the same document payload.
  }
  try {
    const fallback = typeof localStorage !== 'undefined' ? localStorage.getItem(FALLBACK_KEY) : null;
    if (fallback) {
      const parsed = JSON.parse(fallback) as PersistedPayload;
      if (parsed?.document && validDocument(parsed.document)) {
        const base = createInitialState();
        return { ...base, document: parsed.document, theme: parsed.theme === 'dark' ? 'dark' : 'light', panels: parsed.panels ?? base.panels };
      }
    }
  } catch {
    // A fresh document is safer than surfacing a storage implementation error.
  }
  return createInitialState();
}

export async function saveEditorState(state: EditorState): Promise<void> {
  const payload = payloadFromState(state);
  try {
    await indexedWrite(payload);
    return;
  } catch {
    // Continue to the bounded fallback for browsers without IndexedDB.
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is best-effort; the current in-memory document remains usable.
  }
}

export function importDocumentIntoState(state: EditorState, raw: string): EditorState {
  return replaceDocumentState(state, deserializeDocument(raw));
}
