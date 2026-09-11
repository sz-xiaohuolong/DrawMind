/**
 * draw.io Embed Mode JSON protocol message types (postMessage).
 * Based on the official docs: https://www.drawio.com/docs/reference/embed-mode/
 */

export interface LoadMessage {
  action: 'load';
  xml: string;
  autosave?: 1 | 0;
  modified?: string;
  dark?: boolean;
  border?: number;
  fit?: 1 | 0;
  title?: string;
  background?: string;
}

export interface MergeMessage {
  action: 'merge';
  xml: string;
}

export interface ExportMessage {
  action: 'export';
  format: string;
  border?: number;
  scale?: number;
  background?: string;
  transparent?: boolean;
  spinKey?: string;
  pageId?: string;
  currentPage?: boolean;
}

export interface FitMessage {
  action: 'fit';
  border?: number;
  maxScale?: number;
}

export interface StatusMessage {
  action: 'status';
  message: string;
  modified?: boolean;
}

export interface SpinnerMessage {
  action: 'spinner';
  message?: string;
  show: boolean;
}

export interface ConfigureMessage {
  action: 'configure';
  config: Record<string, unknown>;
}

export interface InvokeActionMessage {
  action: 'invokeAction';
  actionName: string;
}

export type HostMessage =
  | LoadMessage
  | MergeMessage
  | ExportMessage
  | FitMessage
  | StatusMessage
  | SpinnerMessage
  | ConfigureMessage
  | InvokeActionMessage;

/** Events sent by the editor. */
export interface InitEvent {
  event: 'init';
}
export interface ConfigureEvent {
  event: 'configure';
}
export interface AutosaveEvent {
  event: 'autosave';
  xml: string;
  modified?: string;
}
export interface SaveEvent {
  event: 'save';
  xml: string;
  exit?: boolean;
}
export interface ExitEvent {
  event: 'exit';
  modified?: boolean;
}
export interface ExportEvent {
  event: 'export';
  format: string;
  data?: string;
  xml?: string;
  message?: string;
}
export interface ErrorEvent {
  error?: string;
  message?: string;
}
export interface LoadResponseEvent {
  event: 'load';
  bounds?: unknown;
  modelBounds?: unknown;
}

export type EditorEvent =
  | InitEvent
  | ConfigureEvent
  | AutosaveEvent
  | SaveEvent
  | ExitEvent
  | ExportEvent
  | LoadResponseEvent
  | ErrorEvent;

export type EditorMessageHandler = (msg: EditorEvent) => void;

export interface EditorConfig {
  darkMode?: string;
  defaultFonts?: string[];
  customFonts?: string[];
  hideMenuItems?: string[];
  /**
   * Optional inline-embed tweaks (see docs): noResizers, preserveViewState,
   * passiveScroll, useInternalClipboard.
   */
  [key: string]: unknown;
}

/** Build the standard embed URL for the iframe. */
export function buildEmbedUrl(): string {
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    spin: '正在加载图表…',
    modified: 'unsavedChanges',
    libraries: '1',
    configure: '1',
    noExitBtn: '1',
    saveAndExit: '0',
    nav: '1',
    lang: 'zh',
    noSaveBtn: '1',
  });
  return `https://embed.diagrams.net/?${params.toString()}`;
}

export function isEditorMessage(data: unknown): data is EditorEvent {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.event === 'string' || typeof d.error === 'string';
}
