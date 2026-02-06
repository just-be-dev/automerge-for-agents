/**
 * Effect RPC Client for automerge-fs
 *
 * Provides a typed client for making RPC calls to the daemon.
 */

import { Effect, pipe } from "effect"
import { connectClient, type ClientConnection } from "./transport"
import { TransportError } from "../errors"
import type * as schema from "./schema"

// =============================================================================
// Client Interface
// =============================================================================

export interface AmfsClient {
  // File Operations
  read: (path: string) => Effect.Effect<schema.ReadResult, TransportError>
  write: (
    path: string,
    content: string,
    encoding?: "utf-8" | "base64"
  ) => Effect.Effect<void, TransportError>
  append: (path: string, content: string) => Effect.Effect<void, TransportError>
  stat: (path: string) => Effect.Effect<schema.FileStat, TransportError>
  readdir: (path: string) => Effect.Effect<schema.DirEntry[], TransportError>
  mkdir: (
    path: string,
    recursive?: boolean
  ) => Effect.Effect<void, TransportError>
  rm: (path: string) => Effect.Effect<void, TransportError>
  exists: (path: string) => Effect.Effect<boolean, TransportError>
  rename: (
    oldPath: string,
    newPath: string
  ) => Effect.Effect<void, TransportError>
  copy: (src: string, dest: string) => Effect.Effect<void, TransportError>

  // Bash Execution
  bash: (
    command: string,
    cwd?: string
  ) => Effect.Effect<schema.BashResult, TransportError>

  // Version Control
  snapshot: (
    name?: string
  ) => Effect.Effect<schema.SnapshotResult, TransportError>
  history: (
    path?: string
  ) => Effect.Effect<schema.HistoryResult, TransportError>
  getFileAt: (
    path: string,
    heads: string[]
  ) => Effect.Effect<string, TransportError>
  diff: (
    path: string,
    fromHeads: string[],
    toHeads: string[]
  ) => Effect.Effect<unknown[], TransportError>
  getFileHeads: (
    path: string
  ) => Effect.Effect<string[], TransportError>

  // Service Control
  status: () => Effect.Effect<schema.ServiceStatus, TransportError>
  shutdown: () => Effect.Effect<{ ok: true }, TransportError>

  // Connection
  close: () => Effect.Effect<void>
}

// =============================================================================
// RPC Call Helper
// =============================================================================

const makeRpcCall = <T>(
  conn: ClientConnection,
  method: string,
  params: unknown
): Effect.Effect<T, TransportError> =>
  conn.call<{ _tag: string; [key: string]: unknown }, T>({
    _tag: method,
    ...params as object,
  })

// =============================================================================
// Client Implementation
// =============================================================================

const makeClient = (conn: ClientConnection): AmfsClient => ({
  read: (path) =>
    makeRpcCall<schema.ReadResult>(conn, "read", { path }),

  write: (path, content, encoding) =>
    makeRpcCall<void>(conn, "write", { path, content, encoding }),

  append: (path, content) =>
    makeRpcCall<void>(conn, "append", { path, content }),

  stat: (path) =>
    makeRpcCall<schema.FileStat>(conn, "stat", { path }),

  readdir: (path) =>
    makeRpcCall<schema.DirEntry[]>(conn, "readdir", { path }),

  mkdir: (path, recursive) =>
    makeRpcCall<void>(conn, "mkdir", { path, recursive }),

  rm: (path) =>
    makeRpcCall<void>(conn, "rm", { path }),

  exists: (path) =>
    makeRpcCall<boolean>(conn, "exists", { path }),

  rename: (oldPath, newPath) =>
    makeRpcCall<void>(conn, "rename", { oldPath, newPath }),

  copy: (src, dest) =>
    makeRpcCall<void>(conn, "copy", { src, dest }),

  bash: (command, cwd) =>
    makeRpcCall<schema.BashResult>(conn, "bash", { command, cwd }),

  snapshot: (name) =>
    makeRpcCall<schema.SnapshotResult>(conn, "snapshot", { name }),

  history: (path) =>
    makeRpcCall<schema.HistoryResult>(conn, "history", { path }),

  getFileAt: (path, heads) =>
    makeRpcCall<string>(conn, "getFileAt", { path, heads }),

  diff: (path, fromHeads, toHeads) =>
    makeRpcCall<unknown[]>(conn, "diff", { path, fromHeads, toHeads }),

  getFileHeads: (path) =>
    makeRpcCall<string[]>(conn, "getFileHeads", { path }),

  status: () =>
    makeRpcCall<schema.ServiceStatus>(conn, "status", {}),

  shutdown: () =>
    makeRpcCall<{ ok: true }>(conn, "shutdown", {}),

  close: () => conn.close(),
})

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Creates a connected client to the daemon.
 */
export const createClient = (
  socketPath: string
): Effect.Effect<AmfsClient, TransportError> =>
  pipe(connectClient(socketPath), Effect.map(makeClient))

/**
 * Creates a Promise-based client for use in CLI.
 */
export const createPromiseClient = async (
  socketPath: string
): Promise<{
  client: AmfsClient
  close: () => void
}> => {
  const client = await Effect.runPromise(createClient(socketPath))
  return {
    client,
    close: () => Effect.runSync(client.close()),
  }
}
