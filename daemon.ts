#!/usr/bin/env bun
/**
 * automerge-fsd - Automerge Filesystem Daemon
 *
 * Long-running Bun service that exposes AutomergeFs via Cap'n Web RPC
 * over a Unix domain socket.
 *
 * Usage:
 *   bun run daemon.ts start [--socket /tmp/amfs.sock] [--data ~/.automerge-fs]
 */

import { RpcTarget, RpcSession } from "capnweb";
import { Repo } from "@automerge/automerge-repo";
import { Bash } from "just-bash";
import { BunSocketTransport, type AmfsService } from "./rpc-transport";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * The main RPC service exposed to clients.
 * Extends capnweb's RpcTarget so methods are callable over RPC.
 */
class AmfsServiceImpl extends RpcTarget implements AmfsService {
  private fs: any; // AutomergeFsMultiDoc
  private bash: Bash;
  private startTime: number;
  private dataDir: string;

  constructor(fs: any, bash: Bash, dataDir: string) {
    super();
    this.fs = fs;
    this.bash = bash;
    this.dataDir = dataDir;
    this.startTime = Date.now();
  }

  // ---------------------------------------------------------------------------
  // File Operations
  // ---------------------------------------------------------------------------

  async read(path: string) {
    const content = await this.fs.readFile(path);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
      return { content: text, encoding: "utf-8" as const };
    } catch {
      return {
        content: Buffer.from(content).toString("base64"),
        encoding: "base64" as const,
      };
    }
  }

  async write(path: string, content: string, encoding?: "utf-8" | "base64") {
    const bytes = encoding === "base64"
      ? Buffer.from(content, "base64")
      : content;
    await this.fs.writeFile(path, bytes);
  }

  async append(path: string, content: string) {
    await this.fs.appendFile(path, content);
  }

  async stat(path: string) {
    const s = await this.fs.stat(path);
    return {
      size: s.size,
      isFile: s.isFile,
      isDirectory: s.isDirectory,
      isSymbolicLink: s.isSymbolicLink,
      mode: s.mode,
      mtime: s.mtime.toISOString(),
      ctime: s.ctime.toISOString(),
    };
  }

  async readdir(path: string) {
    return this.fs.readdir(path);
  }

  async mkdir(path: string, recursive = false) {
    await this.fs.mkdir(path, { recursive });
  }

  async rm(path: string) {
    await this.fs.unlink(path);
  }

  async exists(path: string) {
    return this.fs.exists(path);
  }

  async rename(oldPath: string, newPath: string) {
    const content = await this.fs.readFile(oldPath);
    await this.fs.writeFile(newPath, content);
    await this.fs.unlink(oldPath);
  }

  async copy(src: string, dest: string) {
    const content = await this.fs.readFile(src);
    await this.fs.writeFile(dest, content);
  }

  // ---------------------------------------------------------------------------
  // Bash Execution
  // ---------------------------------------------------------------------------

  async bash(command: string, cwd?: string) {
    const result = await this.bash.exec(command, { cwd });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  // ---------------------------------------------------------------------------
  // Version Control
  // ---------------------------------------------------------------------------

  async snapshot(name?: string) {
    const heads = this.fs.getRootHeads();
    return {
      heads: heads.map(String),
      name,
      timestamp: Date.now(),
    };
  }

  async history(path?: string) {
    if (path) {
      const history = await this.fs.getFileHistory(path);
      return { type: "file" as const, path, history };
    }
    const rootDoc = await this.fs.rootHandle?.doc?.();
    return {
      type: "root" as const,
      operationLog: rootDoc?.operationLog ?? [],
    };
  }

  async getFileAt(path: string, heads: string[]) {
    return this.fs.getFileAt(path, heads);
  }

  // ---------------------------------------------------------------------------
  // Service Control
  // ---------------------------------------------------------------------------

  async status() {
    const docs = await this.fs.getAllDocumentIds();
    const blobs = await this.fs.getAllBlobHashes();
    const mem = process.memoryUsage();

    return {
      pid: process.pid,
      runtime: "bun",
      version: Bun.version,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      dataDir: this.dataDir,
      documents: docs.length,
      blobs: blobs.length,
      memory: {
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        rss: Math.round(mem.rss / 1024 / 1024),
      },
    };
  }

  async shutdown() {
    console.log("Shutdown requested via RPC");
    setTimeout(() => process.exit(0), 100);
    return { ok: true as const };
  }
}

// =============================================================================
// Daemon Server
// =============================================================================

async function startDaemon(options: { socketPath: string; dataDir: string }) {
  const { socketPath, dataDir } = options;

  // Ensure directories exist
  mkdirSync(join(dataDir, "automerge"), { recursive: true });
  mkdirSync(join(dataDir, "blobs"), { recursive: true });

  // Clean up stale socket
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {}
  }

  console.log("Initializing Automerge filesystem...");

  // Dynamic imports
  const { AutomergeFsMultiDoc } = await import("./automerge-fs-v2");
  const { FileSystemBlobStore } = await import("./blob-stores");

  // Initialize components
  const repo = new Repo({});
  const blobStore = new FileSystemBlobStore(join(dataDir, "blobs"));
  const fs = await AutomergeFsMultiDoc.create({ repo, blobStore });
  const bash = new Bash({ fs: fs as any });

  // Create the service
  const service = new AmfsServiceImpl(fs, bash, dataDir);

  // Track active sessions
  const sessions = new Map<import("bun").Socket, RpcSession<any>>();

  console.log(`Starting Cap'n Web RPC server on unix://${socketPath}`);

  // Start Unix socket server
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        console.log("Client connected");

        // Create transport for this socket
        const transport = new BunSocketTransport(socket);

        // Create Cap'n Web RPC session
        // The client doesn't expose a main interface, so pass undefined
        const session = new RpcSession(transport, service);
        sessions.set(socket, session);
      },

      data(socket, data) {
        // Route data to the transport
        const session = sessions.get(socket);
        if (session) {
          // Get the transport from the session and feed it data
          const transport = (session as any).transport as BunSocketTransport;
          transport.onData(data);
        }
      },

      close(socket) {
        console.log("Client disconnected");
        const session = sessions.get(socket);
        if (session) {
          const transport = (session as any).transport as BunSocketTransport;
          transport.onClose();
          sessions.delete(socket);
        }
      },

      error(socket, error) {
        console.error("Socket error:", error);
        const session = sessions.get(socket);
        if (session) {
          const transport = (session as any).transport as BunSocketTransport;
          transport.onClose(error);
          sessions.delete(socket);
        }
      },
    },
  });

  // Print startup banner
  console.log(`
┌──────────────────────────────────────────────────────────────┐
│                    automerge-fsd                             │
│                  Cap'n Web + Bun Edition                     │
├──────────────────────────────────────────────────────────────┤
│  Socket: ${socketPath.padEnd(50)}│
│  Data:   ${dataDir.padEnd(50)}│
│  PID:    ${String(process.pid).padEnd(50)}│
│  Bun:    ${Bun.version.padEnd(50)}│
└──────────────────────────────────────────────────────────────┘
`);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    server.stop();
    try {
      unlinkSync(socketPath);
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

const args = Bun.argv.slice(2);
const command = args[0];

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const socketPath = getArg("--socket") ?? "/tmp/amfs.sock";
const dataDir = getArg("--data") ?? `${Bun.env.HOME}/.automerge-fs`;

switch (command) {
  case "start":
    await startDaemon({ socketPath, dataDir });
    break;

  default:
    console.log(`
automerge-fsd - Automerge Filesystem Daemon

Usage:
  bun run daemon.ts start [options]

Options:
  --socket PATH    Unix socket path (default: /tmp/amfs.sock)
  --data PATH      Data directory (default: ~/.automerge-fs)

Cap'n Web RPC over Unix socket for minimal latency.
`);
}
