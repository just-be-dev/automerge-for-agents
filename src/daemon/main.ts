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

import { Runtime } from "effect"
import { existsSync, unlinkSync } from "fs"
import { initializeDaemonServices, type DaemonConfig } from "./Layer"
import { makeRouter } from "../rpc/router"
import { makeServerConnection, type ServerConnection } from "../rpc/transport"

// =============================================================================
// Daemon Server
// =============================================================================

async function startDaemon(config: DaemonConfig) {
  const { socketPath, dataDir } = config

  // Clean up stale socket
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath)
    } catch {}
  }

  console.log("Initializing Automerge filesystem...")

  // Initialize all services
  const services = await initializeDaemonServices(config)

  // Create the RPC router
  const router = makeRouter({
    fsService: services.fsService,
    bashService: services.bashService,
    dataDir: config.dataDir,
    startTime: Date.now(),
  })

  // Track active connections
  const connections = new Map<unknown, ServerConnection>()
  const runtime = Runtime.defaultRuntime

  console.log(`Starting Effect RPC server on unix://${socketPath}`)

  // Start Unix socket server
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        console.log("Client connected")

        // Create server connection handler
        const connection = Runtime.runSync(runtime)(
          makeServerConnection(socket, router)
        )

        connections.set(socket, connection)
      },

      data(socket, data) {
        const connection = connections.get(socket)
        if (connection) {
          Runtime.runSync(runtime)(connection.onData(data))
        }
      },

      close(socket) {
        console.log("Client disconnected")
        const connection = connections.get(socket)
        if (connection) {
          Runtime.runSync(runtime)(connection.onClose())
          connections.delete(socket)
        }
      },

      error(socket, error) {
        console.error("Socket error:", error)
        const connection = connections.get(socket)
        if (connection) {
          Runtime.runSync(runtime)(connection.onClose(error))
          connections.delete(socket)
        }
      },
    },
  })

  // Print startup banner
  console.log(`
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

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...")
    server.stop()
    try {
      unlinkSync(socketPath)
    } catch {}
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  return server
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
    await startDaemon({ socketPath, dataDir })
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
