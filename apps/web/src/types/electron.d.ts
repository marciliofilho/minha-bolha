/** Tipos da ponte do shell Electron e do elemento <webview>. */
import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react';

export type UpdateCheckResult =
  | { status: 'dev' | 'not-configured' | 'none'; version?: string }
  | {
      status: 'available';
      mode: 'installed' | 'portable';
      version: string;
      currentVersion: string;
      releaseUrl?: string;
      assetUrl?: string | null;
      size?: number | null;
    }
  | { status: 'error'; message: string }
  | { status: 'manual'; releaseUrl: string | null; version: string | null }
  | { status: 'downloading' | 'downloaded' | 'installing'; version?: string | null };

export type UpdateEvent =
  | {
      type: 'available';
      mode: 'installed' | 'portable';
      version: string;
      currentVersion: string;
      releaseUrl?: string;
      assetUrl?: string | null;
    }
  | { type: 'progress'; percent: number; transferred: number; total: number }
  | { type: 'downloaded' | 'installing'; version?: string | null }
  | { type: 'error'; message: string };

export interface BridgeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None' | null;
  expires: number | null;
}

export interface HubDesktopBridge {
  isDesktop: boolean;
  platform: string;
  chromeVersion: string;
  electronVersion: string;
  userAgent: string;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateCheckResult>;
  openVerification: (url: string) => Promise<{ ok?: boolean; error?: string }>;
  readVerificationCookies: (url: string) => Promise<{ cookies: BridgeCookie[] }>;
  closeVerification: () => Promise<{ ok: boolean }>;
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => void;
}

export interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  focus(): void;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

declare global {
  interface Window {
    hubDesktop?: HubDesktopBridge;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        useragent?: string;
        allowpopups?: string;
        webpreferences?: string;
        ref?: Ref<WebviewElement>;
      };
    }
  }
}
