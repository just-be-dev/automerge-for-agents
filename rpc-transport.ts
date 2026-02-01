/**
 * Cap'n Web transport adapter for Bun Unix sockets
 *
 * Implements the RpcTransport interface from capnweb to enable
 * RPC communication over Unix domain sockets using Bun's native APIs.
 */

import type { RpcTransport } from "capnweb";

/**
 * Cap'n Web RPC transport over a Bun TCP/Unix socket.
 * Uses length-prefixed framing for message boundaries.
 */
export class BunSocketTransport implements RpcTransport {
  private socket: import("bun").Socket;
  private messageQueue: string[] = [];
  private pendingReceive: {
    resolve: (msg: string) => void;
    reject: (err: Error) => void;
  } | null = null;
  private closed = false;
  private closeError: Error | null = null;
  private buffer = "";

  constructor(socket: import("bun").Socket) {
    this.socket = socket;
  }

  /**
   * Called by the socket handler when data is received.
   * Parses newline-delimited JSON messages.
   */
  onData(data: string | Buffer) {
    const str = typeof data === "string" ? data : data.toString("utf-8");
    this.buffer += str;

    // Parse newline-delimited messages
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      if (this.pendingReceive) {
        const { resolve } = this.pendingReceive;
        this.pendingReceive = null;
        resolve(line);
      } else {
        this.messageQueue.push(line);
      }
    }
  }

  /**
   * Called when the socket closes or errors.
   */
  onClose(error?: Error) {
    this.closed = true;
    this.closeError = error || new Error("Connection closed");

    if (this.pendingReceive) {
      this.pendingReceive.reject(this.closeError);
      this.pendingReceive = null;
    }
  }

  async send(message: string): Promise<void> {
    if (this.closed) {
      throw this.closeError || new Error("Connection closed");
    }
    // Newline-delimited JSON
    this.socket.write(message + "\n");
  }

  async receive(): Promise<string> {
    // Return queued message if available
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    // If closed, reject
    if (this.closed) {
      throw this.closeError || new Error("Connection closed");
    }

    // Wait for next message
    return new Promise((resolve, reject) => {
      this.pendingReceive = { resolve, reject };
    });
  }

  abort(reason: any): void {
    this.closeError = reason instanceof Error ? reason : new Error(String(reason));
    this.closed = true;
    try {
      this.socket.end();
    } catch {}
  }
}

/**
 * Create a server-side transport from a Bun socket.
 * Returns a transport that can be passed to RpcSession.
 */
export function createServerTransport(socket: import("bun").Socket): BunSocketTransport {
  const transport = new BunSocketTransport(socket);

  // Wire up socket events
  // Note: This assumes the socket handlers will call transport.onData/onClose
  return transport;
}

/**
 * Connect to a Unix socket and return a transport.
 */
export async function connectUnixSocket(socketPath: string): Promise<{
  transport: BunSocketTransport;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let transport: BunSocketTransport;

    const socket = Bun.connect({
      unix: socketPath,
      socket: {
        data(socket, data) {
          transport.onData(data);
        },
        open(socket) {
          transport = new BunSocketTransport(socket);
          resolve({
            transport,
            close: () => socket.end(),
          });
        },
        close(socket) {
          transport?.onClose();
        },
        error(socket, error) {
          if (transport) {
            transport.onClose(error);
          } else {
            reject(error);
          }
        },
        connectError(socket, error) {
          reject(error);
        },
      },
    });
  });
}

// =============================================================================
// TypeScript interface for the AMFS service
// =============================================================================

/**
 * The RPC interface exposed by the daemon.
 * Used for type safety on both client and server.
 */
export interface AmfsService {
  // File operations
  read(path: string): Promise<{ content: string; encoding: "utf-8" | "base64" }>;
  write(path: string, content: string, encoding?: "utf-8" | "base64"): Promise<void>;
  append(path: string, content: string): Promise<void>;
  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<DirEntry[]>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rm(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;

  // Bash execution
  bash(command: string, cwd?: string): Promise<BashResult>;

  // Version control
  snapshot(name?: string): Promise<SnapshotResult>;
  history(path?: string): Promise<HistoryResult>;
  getFileAt(path: string, heads: string[]): Promise<string>;

  // Service control
  status(): Promise<ServiceStatus>;
  shutdown(): Promise<{ ok: true }>;
}

export interface FileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  mode: number;
  mtime: string;
  ctime: string;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SnapshotResult {
  heads: string[];
  name?: string;
  timestamp: number;
}

export interface HistoryResult {
  type: "file" | "root";
  path?: string;
  history?: any[];
  operationLog?: any[];
}

export interface ServiceStatus {
  pid: number;
  runtime: string;
  version: string;
  uptime: number;
  dataDir: string;
  documents: number;
  blobs: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}
