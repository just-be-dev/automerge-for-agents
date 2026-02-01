#!/usr/bin/env bun
/**
 * amfs - Automerge Filesystem CLI
 *
 * Thin Bun client that talks to automerge-fsd via Cap'n Web RPC
 * over Unix socket. Designed to be called from Claude Code hooks.
 *
 * Usage:
 *   amfs read <path>
 *   amfs write <path> [content]
 *   amfs bash <command>
 *   amfs status
 *   ... etc
 */

import { RpcSession, type RpcStub } from "capnweb";
import {
  connectUnixSocket,
  type AmfsService,
} from "./rpc-transport";

const SOCKET_PATH = Bun.env.AMFS_SOCKET ?? "/tmp/amfs.sock";

// =============================================================================
// RPC Client
// =============================================================================

async function createClient(): Promise<{
  api: RpcStub<AmfsService>;
  close: () => void;
}> {
  const { transport, close } = await connectUnixSocket(SOCKET_PATH);

  // Create Cap'n Web session (client side - no local service to expose)
  const session = new RpcSession<AmfsService>(transport);

  // Get stub for the server's main interface
  const api = session.getRemoteMain();

  return {
    api,
    close: () => {
      session[Symbol.dispose]?.();
      close();
    },
  };
}

// =============================================================================
// CLI Commands
// =============================================================================

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch (err: any) {
    output({ ok: false, error: `Cannot connect to daemon: ${err.message}` });
    process.exit(1);
  }

  try {
    switch (command) {
      case "read": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs read <path>");

        const result = await client.api.read(path);

        // For UTF-8, output raw for piping
        if (result.encoding === "utf-8") {
          process.stdout.write(result.content);
        } else {
          output({ ok: true, ...result });
        }
        break;
      }

      case "write": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs write <path> [content]");

        let content: string;
        if (args[2] !== undefined) {
          content = args.slice(2).join(" ");
        } else {
          content = await readStdin();
        }

        await client.api.write(path, content);
        output({ ok: true });
        break;
      }

      case "append": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs append <path> [content]");

        let content: string;
        if (args[2] !== undefined) {
          content = args.slice(2).join(" ");
        } else {
          content = await readStdin();
        }

        await client.api.append(path, content);
        output({ ok: true });
        break;
      }

      case "stat": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs stat <path>");

        const result = await client.api.stat(path);
        output({ ok: true, ...result });
        break;
      }

      case "ls": {
        const path = args[1] ?? "/";
        const result = await client.api.readdir(path);
        output({ ok: true, entries: result });
        break;
      }

      case "mkdir": {
        const path = args.filter((a) => !a.startsWith("-")).slice(1)[0];
        if (!path) throw new Error("Usage: amfs mkdir [-p] <path>");

        const recursive = args.includes("-p") || args.includes("--recursive");
        await client.api.mkdir(path, recursive);
        output({ ok: true });
        break;
      }

      case "rm": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs rm <path>");

        await client.api.rm(path);
        output({ ok: true });
        break;
      }

      case "mv": {
        const src = args[1];
        const dest = args[2];
        if (!src || !dest) throw new Error("Usage: amfs mv <src> <dest>");

        await client.api.rename(src, dest);
        output({ ok: true });
        break;
      }

      case "cp": {
        const src = args[1];
        const dest = args[2];
        if (!src || !dest) throw new Error("Usage: amfs cp <src> <dest>");

        await client.api.copy(src, dest);
        output({ ok: true });
        break;
      }

      case "exists": {
        const path = args[1];
        if (!path) throw new Error("Usage: amfs exists <path>");

        const exists = await client.api.exists(path);
        output({ ok: true, exists });
        break;
      }

      case "bash": {
        const cmd = args.slice(1).join(" ");
        if (!cmd) throw new Error("Usage: amfs bash <command>");

        const result = await client.api.bash(cmd);

        // Output like real bash
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        process.exit(result.exitCode);
        break;
      }

      case "snapshot": {
        const name = args[1];
        const result = await client.api.snapshot(name);
        output({ ok: true, ...result });
        break;
      }

      case "history": {
        const path = args[1];
        const result = await client.api.history(path);
        output({ ok: true, ...result });
        break;
      }

      case "status": {
        const result = await client.api.status();
        output({ ok: true, ...result });
        break;
      }

      case "shutdown": {
        await client.api.shutdown();
        output({ ok: true, message: "Daemon shutting down" });
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (err: any) {
    output({ ok: false, error: err.message });
    process.exit(1);
  } finally {
    client.close();
  }
}

// =============================================================================
// Helpers
// =============================================================================

function output(data: any) {
  console.log(JSON.stringify(data));
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function printUsage() {
  console.log(`
amfs - Automerge Filesystem CLI

Cap'n Web RPC client for automerge-fsd daemon.

Commands:
  read <path>              Read file (raw UTF-8 output)
  write <path> [content]   Write file (stdin if no content)
  append <path> [content]  Append to file
  stat <path>              File/directory info
  ls [path]                List directory
  mkdir [-p] <path>        Create directory
  rm <path>                Remove file
  mv <src> <dest>          Move/rename
  cp <src> <dest>          Copy
  exists <path>            Check existence
  bash <command>           Execute command
  snapshot [name]          Create snapshot
  history [path]           Show history
  status                   Daemon status
  shutdown                 Stop daemon

Environment:
  AMFS_SOCKET              Socket path (default: /tmp/amfs.sock)

Examples:
  amfs read /home/user/file.txt
  echo "hello" | amfs write /home/user/file.txt
  amfs bash "ls -la"
  amfs snapshot "checkpoint-1"
`);
}

// Run
main().catch((err) => {
  output({ ok: false, error: err.message });
  process.exit(1);
});
