export type ShapeKind = 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'polygon';
export type NodeType = 'artboard' | 'frame' | 'text' | ShapeKind | 'image';

export type SemanticTarget = {
  selection?: boolean;
  fileId?: string;
  fileName?: string;
  pageId?: string;
  frameId?: string;
  frameName?: string;
  // Kept for the internal migration boundary; public tool schemas use frameId/frameName.
  artboardId?: string;
  artboardName?: string;
  name?: string;
  type?: NodeType;
  content?: string;
  bindingKey?: string;
};

export type LayoutMode = 'free' | 'flex-row' | 'flex-column';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';
export type JustifyContent = 'start' | 'center' | 'end' | 'space-between';
export type SizingMode = 'fixed' | 'hug' | 'fill';
export type ImageRole = 'reference' | 'content';
export type ThemeMode = 'light' | 'dark';
export type ActionSource = 'human' | 'agent';

export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type Viewport = {
  zoom: number;
  pan: Point;
};

export type NodeStyle = {
  fill: string;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
  borderRadius: number;
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  lineHeight: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right';
};

export type LayoutStyle = {
  mode: LayoutMode;
  gap: number;
  padding: number;
  alignItems: AlignItems;
  justifyContent: JustifyContent;
  clipContent: boolean;
  wrap: boolean;
};

export type NodeSizing = {
  width: SizingMode;
  height: SizingMode;
};

export type LayerAnnotation = {
  id: string;
  text: string;
  resolved: boolean;
};

export type ImageMetadata = {
  assetId: string;
  originalName: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
  role: ImageRole;
  label: string;
  alt: string;
  palette: string[];
  fit?: 'contain' | 'cover';
};

export type BindingMetadata = {
  key: string;
  sourceLabel?: string;
  lastUpdatedAt: string;
  sharedValue?: string;
};

export type DesignNode = {
  id: string;
  type: NodeType;
  name: string;
  isGroup?: boolean;
  pageId: string;
  parentId: string | null;
  childIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  sizing?: NodeSizing;
  style: NodeStyle;
  layout?: LayoutStyle;
  shape?: {
    sides?: number;
  };
  content?: string;
  image?: ImageMetadata;
  hidden: boolean;
  locked: boolean;
  binding?: BindingMetadata;
  annotations?: LayerAnnotation[];
  updatedAt: string;
};

export type Page = {
  id: string;
  name: string;
  rootIds: string[];
};

export type ImageAsset = {
  id: string;
  dataUrl: string;
  originalName: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
  palette: string[];
  sourceLabel?: string;
  createdAt: string;
};

export type EaselFile = {
  id: string;
  name: string;
  document: DocumentModel;
  updatedAt: string;
  open: boolean;
};

export type SelectionState = {
  ids: string[];
  primaryId: string | null;
};

export type DocumentModel = {
  id: string;
  name: string;
  pages: Page[];
  activePageId: string;
  nodes: Record<string, DesignNode>;
  assets: Record<string, ImageAsset>;
  selection: SelectionState;
  viewport: Viewport;
  revision: number;
  updatedAt: string;
};

export type PanelsState = {
  leftOpen: boolean;
  rightOpen: boolean;
  leftWidth: number;
};

export type HistorySnapshot = {
  document: DocumentModel;
  theme: ThemeMode;
  panels: PanelsState;
};

export type HistoryEntry = HistorySnapshot & {
  label: string;
};

export type LastAction = {
  id: string;
  label: string;
  source: ActionSource;
  changedIds: string[];
  skippedIds: string[];
  failedIds: string[];
  result?: Record<string, unknown>;
  at: number;
};

export type FocusSession = {
  targetIds: string[];
  previousPageId: string;
  previousViewport: Viewport;
  previousPanels: PanelsState;
  startedAt: number;
};

export type PreviewState = {
  kind: 'image' | 'frame';
  title: string;
  imageUrl: string;
  artboardId?: string;
  width?: number;
  height?: number;
  scale?: number;
  snapshotId?: string;
};

export type EditorState = {
  document: DocumentModel;
  files: EaselFile[];
  activeFileId: string;
  theme: ThemeMode;
  panels: PanelsState;
  history: HistoryEntry[];
  future: HistoryEntry[];
  lastAction: LastAction | null;
  focus: FocusSession | null;
  preview: PreviewState | null;
};

export type MutationOutcome = {
  document: DocumentModel;
  changedIds: string[];
  skippedIds: string[];
  failedIds?: string[];
  result?: Record<string, unknown>;
  message: string;
};

export type CommandResult = {
  state: EditorState;
  changed: boolean;
  message?: string;
};

export type ArtboardPreset =
  | 'website'
  | 'website-mobile'
  | 'graphic'
  | 'custom';

export const ARTBOARD_PRESETS: Record<ArtboardPreset, Size> = {
  website: { width: 880, height: 600 },
  'website-mobile': { width: 390, height: 844 },
  graphic: { width: 480, height: 600 },
  custom: { width: 880, height: 600 },
};

export type ExportFormat = 'png' | 'svg' | 'html' | 'json';

export type ToolResult = {
  ok: boolean;
  action?: string;
  message: string;
  changedIds?: string[];
  skippedIds?: string[];
  failedIds?: string[];
  error?: {
    code: string;
    message: string;
    affectedIds?: string[];
    details?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

export type StageRect = {
  width: number;
  height: number;
};

export type ElementSpec = {
  type: NodeType;
  name?: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  rotation?: number;
  sizing?: NodeSizing;
  content?: string;
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  shape?: { sides?: number };
  image?: Partial<ImageMetadata> & { assetId: string };
  hidden?: boolean;
  locked?: boolean;
  binding?: Partial<BindingMetadata> & { key: string };
  children?: ElementSpec[];
};

type ElementPatchFields = {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  sizing?: Partial<NodeSizing>;
  content?: string;
  annotationIds?: string[];
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  shape?: { sides?: number };
  image?: Partial<ImageMetadata> & { assetId?: string };
  parentId?: string | null;
  hidden?: boolean;
  locked?: boolean;
};

export type ElementPatch = ElementPatchFields & (
  { id: string; target?: never }
  | { id?: never; target: SemanticTarget }
);

export type HistoryRequest = {
  action: 'undo' | 'redo';
  steps: number;
};
