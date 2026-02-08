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

import { runCli } from "./cli"

const args = Bun.argv.slice(2)
runCli(args)
