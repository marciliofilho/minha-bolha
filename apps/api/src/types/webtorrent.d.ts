declare module 'webtorrent' {
  import { EventEmitter } from 'node:events';
  import { Readable } from 'node:stream';

  export interface TorrentFile {
    name: string;
    length: number;
    createReadStream(options?: { start?: number; end?: number }): Readable;
  }

  export interface Torrent extends EventEmitter {
    infoHash: string;
    name: string;
    ready: boolean;
    files: TorrentFile[];
    progress: number;
    numPeers: number;
    destroy(callback?: (error?: Error) => void): void;
  }

  export interface WebTorrentOptions {
    dht?: boolean;
    tracker?: boolean;
    path?: string;
    downloadLimit?: number;
    uploadLimit?: number;
  }

  export interface AddTorrentOptions {
    announce?: string[];
    path?: string;
  }

  export default class WebTorrent extends EventEmitter {
    dht: unknown;
    tracker: unknown;
    constructor(options?: WebTorrentOptions);
    add(torrentId: string, options?: AddTorrentOptions): Torrent;
    get(torrentId: string): Promise<Torrent | null>;
    remove(
      torrentId: string,
      options?: { destroyStore?: boolean },
      callback?: (error?: Error) => void
    ): Promise<void>;
    destroy(callback?: (error?: Error) => void): void;
  }
}

declare module 'ffprobe-static' {
  const value: { path: string };
  export default value;
}
