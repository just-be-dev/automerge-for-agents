/**
 * Effect RPC Router for automerge-fs daemon
 *
 * Defines the server-side router that handles RPC requests.
 * Uses a simple method-dispatch pattern over JSON-RPC.
 */

import { Effect, pipe } from "effect"
import type { AutomergeFsService } from "../services/AutomergeFs"
import type { BashExecutorService } from "../services/BashExecutor"
import type {
  ReadParamsType,
  WriteParamsType,
  AppendParamsType,
  StatParamsType,
  ReaddirParamsType,
  MkdirParamsType,
  RmParamsType,
  ExistsParamsType,
  RenameParamsType,
  CopyParamsType,
  BashParamsType,
  SnapshotParamsType,
  HistoryParamsType,
  GetFileAtParamsType,
  DiffParamsType,
  GetFileHeadsParamsType,
} from "./schema"

// =============================================================================
// Router Context
// =============================================================================

export interface RouterContext {
  fsService: AutomergeFsService
  bashService: BashExecutorService
  dataDir: string
  startTime: number
}

// =============================================================================
// Router Type
// =============================================================================

export type RpcHandler = (params: unknown) => Effect.Effect<unknown, unknown>

export interface AmfsRouter {
  handle: (method: string, params: unknown) => Effect.Effect<unknown, unknown>
}

// =============================================================================
// Router Implementation
// =============================================================================

export const makeRouter = (ctx: RouterContext): AmfsRouter => {
  const handlers: Record<string, RpcHandler> = {
    // File Operations
    read: (params) => {
      const { path } = params as ReadParamsType
      return pipe(
        ctx.fsService.readFile(path),
        Effect.map((content) => {
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(content)
            return { content: text, encoding: "utf-8" as const }
          } catch {
            return {
              content: Buffer.from(content).toString("base64"),
              encoding: "base64" as const,
            }
          }
        })
      )
    },

    write: (params) => {
      const { path, content, encoding } = params as WriteParamsType
      const bytes =
        encoding === "base64" ? Buffer.from(content, "base64") : content
      return ctx.fsService.writeFile(path, bytes)
    },

    append: (params) => {
      const { path, content } = params as AppendParamsType
      return ctx.fsService.appendFile(path, content)
    },

    stat: (params) => {
      const { path } = params as StatParamsType
      return ctx.fsService.stat(path)
    },

    readdir: (params) => {
      const { path } = params as ReaddirParamsType
      return ctx.fsService.readdir(path)
    },

    mkdir: (params) => {
      const { path, recursive } = params as MkdirParamsType
      return ctx.fsService.mkdir(path, { recursive: recursive ?? false })
    },

    rm: (params) => {
      const { path } = params as RmParamsType
      return ctx.fsService.unlink(path)
    },

    exists: (params) => {
      const { path } = params as ExistsParamsType
      return ctx.fsService.exists(path)
    },

    rename: (params) => {
      const { oldPath, newPath } = params as RenameParamsType
      return ctx.fsService.rename(oldPath, newPath)
    },

    copy: (params) => {
      const { src, dest } = params as CopyParamsType
      return ctx.fsService.copy(src, dest)
    },

    // Bash Execution
    bash: (params) => {
      const { command, cwd } = params as BashParamsType
      return ctx.bashService.exec(command, { cwd })
    },

    // Version Control
    snapshot: (params) => {
      const { name } = params as SnapshotParamsType
      return pipe(
        ctx.fsService.getRootHeads(),
        Effect.map((heads) => ({
          heads,
          name: name ?? null,
          timestamp: Date.now(),
        }))
      )
    },

    history: (params) => {
      const { path } = params as HistoryParamsType
      if (path) {
        return pipe(
          ctx.fsService.getFileHistory(path),
          Effect.map((history) => ({
            type: "file" as const,
            path,
            history,
          }))
        )
      }
      return pipe(
        ctx.fsService.getRootDoc(),
        Effect.map((rootDoc) => ({
          type: "root" as const,
          operationLog: rootDoc?.operationLog ?? [],
        }))
      )
    },

    getFileAt: (params) => {
      const { path, heads } = params as GetFileAtParamsType
      return ctx.fsService.getFileAt(path, [...heads])
    },

    diff: (params) => {
      const { path, fromHeads, toHeads } = params as DiffParamsType
      return ctx.fsService.diff(path, [...fromHeads], [...toHeads])
    },

    getFileHeads: (params) => {
      const { path } = params as GetFileHeadsParamsType
      return ctx.fsService.getFileHeads(path)
    },

    // Service Control
    status: () =>
      pipe(
        Effect.all({
          docs: ctx.fsService.getAllDocumentIds(),
          blobs: ctx.fsService.getAllBlobHashes(),
        }),
        Effect.map(({ docs, blobs }) => {
          const mem = process.memoryUsage()
          return {
            pid: process.pid,
            runtime: "bun",
            version: Bun.version,
            uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
            dataDir: ctx.dataDir,
            documents: docs.length,
            blobs: blobs.length,
            memory: {
              heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
              heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
              rss: Math.round(mem.rss / 1024 / 1024),
            },
          }
        })
      ),

    shutdown: () =>
      Effect.sync(() => {
        console.log("Shutdown requested via RPC")
        setTimeout(() => process.exit(0), 100)
        return { ok: true as const }
      }),
  }

  return {
    handle: (method, params) => {
      const handler = handlers[method]
      if (!handler) {
        return Effect.fail(new Error(`Unknown method: ${method}`))
      }
      return handler(params)
    },
  }
}
