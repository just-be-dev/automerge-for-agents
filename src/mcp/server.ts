/**
 * MCP server for automerge-fs
 *
 * Uses @effect/ai's native McpServer with Layer composition.
 *
 * `createHandlers` builds handlers directly from services — call it in tests.
 * `startMcpServer` is the production entry point using stdio transport.
 */

import { McpServer } from "@effect/ai"
import { NodeRuntime, NodeSink, NodeStream } from "@effect/platform-node"
import { Effect, Layer, Logger } from "effect"
import { DaemonConfig, DaemonLive } from "../daemon/Layer"
import { AutomergeFs } from "../services/AutomergeFs"
import type { AutomergeFsService } from "../services/AutomergeFs"
import { BashExecutor } from "../services/BashExecutor"
import type { BashExecutorService } from "../services/BashExecutor"
import { AutomergeToolkit } from "./tools"

// =============================================================================
// Helper
// =============================================================================

function formatResult(result: unknown): string {
  if (result === undefined || result === null) return "OK"
  if (typeof result === "string") return result
  return JSON.stringify(result, null, 2)
}

function toFailure(error: unknown): Effect.Effect<never, string> {
  if (error instanceof Error) {
    // Data.TaggedError instances have empty .message — use String() for a
    // richer representation that includes the tag name and structured fields.
    const message = error.message || String(error)
    return Effect.fail(message)
  }
  return Effect.fail(String(error))
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Create handler record from services directly.
 * Used in tests with mock implementations.
 */
export function createHandlers(
  fs: AutomergeFsService,
  bash: BashExecutorService,
) {
  return AutomergeToolkit.of({
    read_file: ({ path }) =>
      fs.readFile(path).pipe(
        Effect.map((content) => {
          try {
            return new TextDecoder("utf-8", { fatal: true }).decode(content)
          } catch {
            return `[base64] ${Buffer.from(content).toString("base64")}`
          }
        }),
        Effect.catchAll(toFailure),
      ),

    write_file: ({ path, content, encoding }) => {
      const data =
        encoding === "base64" ? Buffer.from(content, "base64") : content
      return fs.writeFile(path, data).pipe(
        Effect.map(() => "OK"),
        Effect.catchAll(toFailure),
      )
    },

    list_directory: ({ path }) =>
      fs.readdir(path).pipe(
        Effect.map((entries) => formatResult(entries)),
        Effect.catchAll(toFailure),
      ),

    create_directory: ({ path, recursive }) =>
      fs.mkdir(path, { recursive: recursive ?? false }).pipe(
        Effect.map(() => "OK"),
        Effect.catchAll(toFailure),
      ),

    remove: ({ path }) =>
      fs.unlink(path).pipe(
        Effect.map(() => "OK"),
        Effect.catchAll(toFailure),
      ),

    stat: ({ path }) =>
      fs.stat(path).pipe(
        Effect.map((s) => formatResult(s)),
        Effect.catchAll(toFailure),
      ),

    exists: ({ path }) =>
      fs.exists(path).pipe(
        Effect.map((e) => formatResult(e)),
        Effect.catchAll(toFailure),
      ),

    move: ({ oldPath, newPath }) =>
      fs.rename(oldPath, newPath).pipe(
        Effect.map(() => "OK"),
        Effect.catchAll(toFailure),
      ),

    copy: ({ src, dest }) =>
      fs.copy(src, dest).pipe(
        Effect.map(() => "OK"),
        Effect.catchAll(toFailure),
      ),

    bash: ({ command, cwd }) =>
      bash.exec(command, { cwd }).pipe(
        Effect.map((r) => formatResult(r)),
        Effect.catchAll(toFailure),
      ),

    snapshot: ({ name }) =>
      fs.getRootHeads().pipe(
        Effect.map((heads) =>
          formatResult({
            heads,
            name: name ?? null,
            timestamp: Date.now(),
          }),
        ),
        Effect.catchAll(toFailure),
      ),

    history: ({ path }) => {
      if (path) {
        return fs.getFileHistory(path).pipe(
          Effect.map((history) =>
            formatResult({
              type: "file" as const,
              path,
              history,
            }),
          ),
          Effect.catchAll(toFailure),
        )
      }
      return fs.getRootDoc().pipe(
        Effect.map((rootDoc) =>
          formatResult({
            type: "root" as const,
            operationLog: rootDoc?.operationLog ?? [],
          }),
        ),
        Effect.catchAll(toFailure),
      )
    },

    diff: ({ path, fromHeads, toHeads }) =>
      fs.diff(path, [...fromHeads], [...toHeads]).pipe(
        Effect.map((patches) => formatResult(patches)),
        Effect.catchAll(toFailure),
      ),
  })
}

// =============================================================================
// Layers
// =============================================================================

const HandlersLayer = AutomergeToolkit.toLayer(
  Effect.gen(function* () {
    const fs = yield* AutomergeFs
    const bash = yield* BashExecutor
    return createHandlers(fs, bash)
  }),
)

// =============================================================================
// Production Entry Point
// =============================================================================

/**
 * Start the MCP server with stdio transport.
 * NodeRuntime.runMain handles SIGINT/SIGTERM lifecycle.
 */
export function startMcpServer(config: { dataDir: string }) {
  const ConfigLayer = Layer.succeed(DaemonConfig, {
    socketPath: "",
    dataDir: config.dataDir,
  })

  const McpLive = Layer.mergeAll(
    McpServer.toolkit(AutomergeToolkit),
  ).pipe(
    Layer.provide(HandlersLayer),
    Layer.provide(McpServer.layerStdio({
      name: "automerge-fs",
      version: "0.3.0",
      stdin: NodeStream.stdin,
      stdout: NodeSink.stdout,
    })),
    Layer.provide(DaemonLive),
    Layer.provide(ConfigLayer),
    // Route Effect.log to stderr so it doesn't pollute the MCP JSON-RPC stream
    Layer.provide(Logger.add(Logger.prettyLogger({ stderr: true }))),
  )

  Layer.launch(McpLive).pipe(NodeRuntime.runMain)
}
