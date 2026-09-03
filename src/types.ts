export type NodeType = 'artboard' | 'frame' | 'text' | 'rectangle' | 'image';

export type LayoutMode = 'free' | 'flex-row' | 'flex-column';
export type AlignItems = 'start' | 'center' | 'end' | 'stretch';
export type JustifyContent = 'start' | 'center' | 'end' | 'space-between';
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
  pageId: string;
  parentId: string | null;
  childIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  style: NodeStyle;
  layout?: LayoutStyle;
  content?: string;
  image?: ImageMetadata;
  hidden: boolean;
  locked: boolean;
  binding?: BindingMetadata;
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
  createdAt: string;
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
  kind: 'image' | 'artboard';
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
  message: string;
};

export type CommandResult = {
  state: EditorState;
  changed: boolean;
  message?: string;
};

export type ArtboardPreset =
  | 'website-desktop'
  | 'website-mobile'
  | 'poster-portrait'
  | 'a4-portrait';

export const ARTBOARD_PRESETS: Record<ArtboardPreset, Size> = {
  'website-desktop': { width: 1440, height: 900 },
  'website-mobile': { width: 390, height: 844 },
  'poster-portrait': { width: 1080, height: 1350 },
  'a4-portrait': { width: 794, height: 1123 },
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
  content?: string;
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  image?: Partial<ImageMetadata> & { assetId: string };
  hidden?: boolean;
  locked?: boolean;
  binding?: Partial<BindingMetadata> & { key: string };
  children?: ElementSpec[];
};

export type ElementPatch = {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  content?: string;
  style?: Partial<NodeStyle>;
  layout?: Partial<LayoutStyle>;
  image?: Partial<ImageMetadata> & { assetId?: string };
  parentId?: string | null;
  hidden?: boolean;
  locked?: boolean;
};
