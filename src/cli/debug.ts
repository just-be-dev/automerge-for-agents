#!/usr/bin/env bun

/**
 * Debug CLI for inspecting Automerge filesystem
 *
 * Usage:
 *   bun run src/cli/debug.ts tree              # Show file tree
 *   bun run src/cli/debug.ts cat <path>        # Show file content
 *   bun run src/cli/debug.ts history <path>    # Show file history
 *   bun run src/cli/debug.ts docs              # List all documents
 *   bun run src/cli/debug.ts inspect <docId>   # Inspect a specific document
 */

import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { DaemonConfig, DaemonLive } from "../daemon/Layer"
import { AutomergeFs } from "../services/AutomergeFs"

const command = process.argv[2]
const arg = process.argv[3]

const debugProgram = Effect.gen(function* () {
  const fs = yield* AutomergeFs

  switch (command) {
    case "tree": {
      console.log("\n📁 Filesystem Tree:\n")

      const printTree = (path: string, prefix = ""): Effect.Effect<void, any, AutomergeFs> =>
        Effect.gen(function* () {
          const entries = yield* fs.readdir(path)
          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]
            if (!entry) continue

            const isLast = i === entries.length - 1
            const connector = isLast ? "└── " : "├── "
            const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`

            console.log(prefix + connector + entry.name + (entry.isDirectory ? "/" : ""))

            if (entry.isDirectory) {
              const newPrefix = prefix + (isLast ? "    " : "│   ")
              yield* printTree(fullPath, newPrefix)
            }
          }
        })

      console.log("/")
      yield* printTree("/", "")
      break
    }

    case "cat": {
      if (!arg) {
        console.error("Usage: debug cat <path>")
        process.exit(1)
      }

      console.log(`\n📄 Content of ${arg}:\n`)
      const content = yield* fs.readFile(arg).pipe(
        Effect.map((bytes) => {
          try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
          } catch {
            return `[Binary file, ${bytes.length} bytes]`
          }
        })
      )
      console.log(content)
      break
    }

    case "history": {
      if (!arg) {
        console.error("Usage: debug history <path>")
        process.exit(1)
      }

      console.log(`\n📜 History of ${arg}:\n`)
      const history = yield* fs.getFileHistory(arg)

      if (history.length === 0) {
        console.log("No history available")
      } else {
        for (const entry of history) {
          if (entry && typeof entry === "object" && "timestamp" in entry && "operation" in entry) {
            console.log(`- ${new Date(entry.timestamp as number).toISOString()}: ${entry.operation}`)
          }
        }
      }
      break
    }

    case "stat": {
      if (!arg) {
        console.error("Usage: debug stat <path>")
        process.exit(1)
      }

      console.log(`\n📊 Stats for ${arg}:\n`)
      const stat = yield* fs.stat(arg)

      console.log(`  Type: ${stat.isFile ? "file" : stat.isDirectory ? "directory" : "unknown"}`)
      console.log(`  Size: ${stat.size} bytes`)
      console.log(`  Mode: ${stat.mode.toString(8)}`)
      console.log(`  Modified: ${new Date(stat.mtime).toISOString()}`)
      console.log(`  Created: ${new Date(stat.ctime).toISOString()}`)
      break
    }

    case "ls": {
      const path = arg || "/"
      console.log(`\n📂 Contents of ${path}:\n`)
      const entries = yield* fs.readdir(path)

      for (const entry of entries) {
        const type = entry.isDirectory ? "DIR " : "FILE"
        const size = "0".padStart(10) // Size not available in directory listing
        console.log(`  ${type}  ${size}  ${entry.name}`)
      }
      break
    }

    case "root": {
      console.log("\n🌳 Root Document:\n")
      const rootDoc = yield* fs.getRootDoc()

      if (rootDoc) {
        console.log("Document structure:")
        console.log(JSON.stringify(rootDoc, null, 2))
      }
      break
    }

    case "heads": {
      console.log("\n🔖 Current Heads:\n")
      const heads = yield* fs.getRootHeads()

      for (const head of heads) {
        console.log(`  ${head}`)
      }
      break
    }

    case "dump": {
      console.log("\n📦 Dumping all file contents:\n")

      const dumpFiles = (path: string): Effect.Effect<void, any, AutomergeFs> =>
        Effect.gen(function* () {
          const entries = yield* fs.readdir(path)

          for (const entry of entries) {
            const fullPath = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`

            if (entry.isDirectory) {
              yield* dumpFiles(fullPath)
            } else {
              console.log(`\n${"=".repeat(60)}`)
              console.log(`📄 ${fullPath}`)
              console.log("=".repeat(60))

              const content = yield* fs.readFile(fullPath).pipe(
                Effect.map((bytes) => {
                  try {
                    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
                  } catch {
                    return `[Binary file, ${bytes.length} bytes]`
                  }
                })
              )
              console.log(content)
            }
          }
        })

      yield* dumpFiles("/")
      console.log(`\n${"=".repeat(60)}\n`)
      break
    }

    case "help":
    default: {
      console.log(`
🔍 Automerge Filesystem Debug CLI

Usage:
  bun run src/cli/debug.ts <command> [args]

Commands:
  tree                  Show the filesystem tree
  ls [path]            List directory contents (default: /)
  cat <path>           Show file content
  stat <path>          Show file metadata
  history <path>       Show file change history
  root                 Show root document structure
  heads                Show current Automerge heads
  dump                 Dump contents of all files in the filesystem
  help                 Show this help message

Examples:
  bun run src/cli/debug.ts tree
  bun run src/cli/debug.ts cat /workspace/demo/notes.txt
  bun run src/cli/debug.ts history /workspace/demo/notes.txt
  bun run src/cli/debug.ts ls /workspace
`)
      break
    }
  }
})

const ConfigLayer = Layer.succeed(DaemonConfig, {
  socketPath: "",
  dataDir: ".data/agent-demo",
})

const program = debugProgram.pipe(
  Effect.catchAll((error) => {
    console.error("\n❌ Error:", error)
    return Effect.void
  }),
  Effect.provide(DaemonLive),
  Effect.provide(ConfigLayer),
)

NodeRuntime.runMain(program)
