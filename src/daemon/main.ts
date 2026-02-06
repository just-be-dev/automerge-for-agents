#!/usr/bin/env bun
/**
 * automerge-fsd - Automerge Filesystem Daemon
 *
 * Long-running Bun service that exposes AutomergeFs via Effect RPC
 * over a Unix domain socket.
 *
 * Usage:
 *   bun run src/daemon/main.ts start [--socket /tmp/amfs.sock] [--data ~/.automerge-fs]
 */

import { Effect, Layer } from "effect"
import { existsSync, unlinkSync } from "fs"
import { NodeRuntime } from "@effect/platform-node"
import * as SocketServer from "@effect/platform/SocketServer"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import { DaemonConfig, DaemonLive } from "./Layer"
import { AutomergeFs } from "../services/AutomergeFs"
import { BashExecutor } from "../services/BashExecutor"
import { makeRouter } from "../rpc/router"
import { handleConnection } from "../rpc/transport"

// =============================================================================
// Effect Helpers
// =============================================================================

const cleanupSocket = (socketPath: string) =>
  Effect.sync(() => {
    if (existsSync(socketPath)) {
      unlinkSync(socketPath)
    }
  }).pipe(Effect.ignore)

// =============================================================================
// Daemon Server
// =============================================================================

function startDaemon(config: { socketPath: string; dataDir: string }) {
  const { socketPath, dataDir } = config

  // Build layers
  const ConfigLayer = Layer.succeed(DaemonConfig, { socketPath, dataDir })
  const ServerLayer = NodeSocketServer.layer({ path: socketPath })
  const fullLayer = Layer.merge(
    DaemonLive.pipe(Layer.provide(ConfigLayer)),
    ServerLayer,
  )

  const program = Effect.gen(function* () {
    yield* cleanupSocket(socketPath)
    yield* Effect.log("Initializing Automerge filesystem...")

    // Extract services and build router
    const fsService = yield* AutomergeFs
    const bashService = yield* BashExecutor

    const router = makeRouter({
      fsService,
      bashService,
      dataDir,
      startTime: Date.now(),
    })

    // Start platform socket server
    const server = yield* SocketServer.SocketServer

    yield* Effect.log(`Starting Effect RPC server on unix://${socketPath}`)
    yield* Effect.log(`
┌──────────────────────────────────────────────────────────────┐
│                    automerge-fsd                             │
│                Effect RPC + Bun Edition                      │
├──────────────────────────────────────────────────────────────┤
│  Socket: ${socketPath.padEnd(50)}│
│  Data:   ${dataDir.padEnd(50)}│
│  PID:    ${String(process.pid).padEnd(50)}│
│  Bun:    ${Bun.version.padEnd(50)}│
└──────────────────────────────────────────────────────────────┘
`)

    // Run forever, handling connections (each connection gets its own scope)
    yield* server.run((socket) =>
      Effect.scoped(handleConnection(socket, router)).pipe(
        Effect.catchAll((error) =>
          Effect.log(`Connection error: ${error}`)
        )
      )
    )
  }).pipe(
    // Clean up socket file on shutdown (interruption, error, or normal exit)
    Effect.ensuring(cleanupSocket(socketPath)),
    Effect.provide(fullLayer),
  )

  // runMain handles SIGINT/SIGTERM by interrupting the fiber,
  // which tears down layers and runs the ensuring cleanup
  NodeRuntime.runMain(program)
}

// =============================================================================
// CLI Entry Point
// =============================================================================

const args = Bun.argv.slice(2)
const command = args[0]

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}

const socketPath = getArg("--socket") ?? "/tmp/amfs.sock"
const dataDir = getArg("--data") ?? `${Bun.env.HOME}/.automerge-fs`

switch (command) {
  case "start":
    startDaemon({ socketPath, dataDir })
    break

  default:
    console.log(`
automerge-fsd - Automerge Filesystem Daemon

Usage:
  bun run src/daemon/main.ts start [options]

Options:
  --socket PATH    Unix socket path (default: /tmp/amfs.sock)
  --data PATH      Data directory (default: ~/.automerge-fs)

Effect RPC over Unix socket for typed, efficient communication.
`)
}
