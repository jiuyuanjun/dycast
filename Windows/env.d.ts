/// <reference types="vite/client" />

// global.d.ts 或 index.d.ts 中

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  // CookieStore API (not in default TS DOM lib yet)
  cookieStore?: CookieStore;
  // Douyin anti-crawler SDK injected by public/mssdk.js
  byted_acrawler?: {
    frontierSign(payload: Record<string, unknown>): Record<string, string>;
  };
  // Tauri runtime marker (present when running inside a Tauri WebView)
  __TAURI_INTERNALS__?: unknown;
}

// Minimal CookieStore typing for the API used in src/utils/cookieUtil.ts
interface CookieStoreItem {
  name: string;
  value: string;
  path?: string;
  expires?: number;
  secure?: boolean;
}

declare class CookieStore {
  get(name?: string): Promise<CookieStoreItem | null>;
  set(options: { name: string; value: string; path?: string; expires?: number }): Promise<void>;
  delete(name: string): Promise<void>;
}
