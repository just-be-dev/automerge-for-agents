import { Effect } from "effect"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Command, Options } from "@effect/cli"
import { startDaemon } from "./server"

// =============================================================================
// Shared Options
// =============================================================================

const socketOption = Options.file("socket", { exists: "either" }).pipe(
  Options.withDefault("/tmp/amfs.sock"),
  Options.withDescription("Unix socket path"),
)

const dataOption = Options.directory("data", { exists: "either" }).pipe(
  Options.withDefault(`${Bun.env.HOME}/.automerge-fs`),
  Options.withDescription("Data directory"),
)

// =============================================================================
// Commands
// =============================================================================

const startCommand = Command.make("start", {
  options: { socket: socketOption, data: dataOption },
}).pipe(
  Command.withHandler((parsed) =>
    Effect.sync(() => {
      startDaemon({
        socketPath: parsed.options.socket,
        dataDir: parsed.options.data,
      })
    }),
  ),
  Command.withDescription("Start the daemon with Effect RPC over Unix socket"),
)

const mcpCommand = Command.make("mcp", {
  options: { data: dataOption },
}).pipe(
  Command.withHandler((parsed) =>
    Effect.gen(function* () {
      // stdout is reserved for MCP JSON-RPC, redirect logs to stderr
      console.log = console.error

      const { startMcpServer } = yield* Effect.promise(() =>
        import("../mcp/server"),
      )
      yield* Effect.sync(() => startMcpServer({ dataDir: parsed.options.data }))
    }),
  ),
  Command.withDescription("Start as an MCP server (JSON-RPC over stdio)"),
)

// =============================================================================
// CLI App
// =============================================================================

const cli = Command.make("automerge-fsd").pipe(
  Command.withDescription("Automerge Filesystem Daemon"),
  Command.withSubcommands([startCommand, mcpCommand]),
)

// =============================================================================
// CLI Entry Point
// =============================================================================

export function runCli(args: string[]) {
  const program = Effect.suspend(() =>
    Command.run(cli, { name: "automerge-fsd", version: "0.3.0" })(args),
  ).pipe(Effect.provide(NodeContext.layer))

  NodeRuntime.runMain(program)
}
