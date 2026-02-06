#!/usr/bin/env bun
/**
 * amfs - Automerge Filesystem CLI
 *
 * Effect CLI-based client that talks to automerge-fsd via Effect RPC
 * over Unix socket. Designed to be called from Claude Code hooks.
 */

import { Effect, Runtime, Option } from "effect";
import { Command, Args, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { createPromiseClient, type AmfsClient } from "../rpc/client";

const SOCKET_PATH = Bun.env.AMFS_SOCKET ?? "/tmp/amfs.sock";

// =============================================================================
// Helper Functions
// =============================================================================

function output(data: unknown) {
  console.log(JSON.stringify(data));
}

const readStdin = Effect.promise(async () => {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
});

const connectToClient = Effect.tryPromise({
  try: () => createPromiseClient(SOCKET_PATH),
  catch: (err) =>
    new Error(
      `Cannot connect to daemon: ${err instanceof Error ? err.message : String(err)}`,
    ),
});

const withClient = <A, E>(
  fn: (client: AmfsClient) => Effect.Effect<A, E>,
): Effect.Effect<A, E | Error> =>
  Effect.gen(function* () {
    const { client, close } = yield* connectToClient;
    try {
      return yield* fn(client);
    } finally {
      close();
    }
  });

// =============================================================================
// Command Definitions
// =============================================================================

const runtime = Runtime.defaultRuntime;

// read <path>
const readCommand = Command.make("read", {
  args: Args.text({ name: "path" }),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const result = yield* client.read(parsed.args);
        if (result.encoding === "utf-8") {
          process.stdout.write(result.content);
        } else {
          output({ ok: true, ...result });
        }
      }),
    ),
  ),
);

// write <path> [--content <content>]
const writeCommand = Command.make("write", {
  args: Args.text({ name: "path" }),
  options: Options.text("content").pipe(Options.optional),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const content = Option.isSome(parsed.options)
          ? parsed.options.value
          : yield* readStdin;
        yield* client.write(parsed.args, content);
        output({ ok: true });
      }),
    ),
  ),
);

// append <path> [--content <content>]
const appendCommand = Command.make("append", {
  args: Args.text({ name: "path" }),
  options: Options.text("content").pipe(Options.optional),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const content = Option.isSome(parsed.options)
          ? parsed.options.value
          : yield* readStdin;
        yield* client.append(parsed.args, content);
        output({ ok: true });
      }),
    ),
  ),
);

// stat <path>
const statCommand = Command.make("stat", {
  args: Args.text({ name: "path" }),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const result = yield* client.stat(parsed.args);
        output({ ok: true, ...result });
      }),
    ),
  ),
);

// ls [path]
const lsCommand = Command.make("ls", {
  args: Args.text({ name: "path" }).pipe(Args.withDefault("/")),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const result = yield* client.readdir(parsed.args);
        output({ ok: true, entries: result });
      }),
    ),
  ),
);

// mkdir <path> [-p]
const mkdirCommand = Command.make("mkdir", {
  args: Args.text({ name: "path" }),
  options: Options.boolean("p").pipe(
    Options.withAlias("recursive"),
    Options.withDefault(false),
  ),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        yield* client.mkdir(parsed.args, parsed.options);
        output({ ok: true });
      }),
    ),
  ),
);

// rm <path>
const rmCommand = Command.make("rm", {
  args: Args.text({ name: "path" }),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        yield* client.rm(parsed.args);
        output({ ok: true });
      }),
    ),
  ),
);

// mv <src> <dest>
const mvCommand = Command.make("mv", {
  args: Args.all([Args.text({ name: "src" }), Args.text({ name: "dest" })]),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const [src, dest] = parsed.args;
        yield* client.rename(src, dest);
        output({ ok: true });
      }),
    ),
  ),
);

// cp <src> <dest>
const cpCommand = Command.make("cp", {
  args: Args.all([Args.text({ name: "src" }), Args.text({ name: "dest" })]),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const [src, dest] = parsed.args;
        yield* client.copy(src, dest);
        output({ ok: true });
      }),
    ),
  ),
);

// exists <path>
const existsCommand = Command.make("exists", {
  args: Args.text({ name: "path" }),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const exists = yield* client.exists(parsed.args);
        output({ ok: true, exists });
      }),
    ),
  ),
);

// bash <command...>
const bashCommand = Command.make("bash", {
  args: Args.text({ name: "command" }).pipe(Args.repeated),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const cmd = parsed.args.join(" ");
        const result = yield* client.bash(cmd);
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        process.exit(result.exitCode);
      }),
    ),
  ),
);

// snapshot [name]
const snapshotCommand = Command.make("snapshot", {
  args: Args.text({ name: "name" }).pipe(Args.optional),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const name = Option.getOrUndefined(parsed.args) as string | undefined;
        const result = yield* client.snapshot(name);
        output({ ok: true, ...result });
      }),
    ),
  ),
);

// history [path]
const historyCommand = Command.make("history", {
  args: Args.text({ name: "path" }).pipe(Args.optional),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const path = Option.getOrUndefined(parsed.args) as string | undefined;
        const result = yield* client.history(path);
        output(Object.assign({ ok: true }, result));
      }),
    ),
  ),
);

// diff <path> <fromHead> <toHead>
const diffCommand = Command.make("diff", {
  args: Args.all([
    Args.text({ name: "path" }),
    Args.text({ name: "fromHead" }),
    Args.text({ name: "toHead" }),
  ]),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const [path, fromHead, toHead] = parsed.args;
        const result = yield* client.diff(path, [fromHead], [toHead]);
        output({ ok: true, patches: result });
      }),
    ),
  ),
);

// heads <path>
const headsCommand = Command.make("heads", {
  args: Args.text({ name: "path" }),
}).pipe(
  Command.withHandler((parsed) =>
    withClient((client) =>
      Effect.gen(function* () {
        const result = yield* client.getFileHeads(parsed.args);
        output({ ok: true, heads: result });
      }),
    ),
  ),
);

// status
const statusCommand = Command.make("status").pipe(
  Command.withHandler(() =>
    withClient((client) =>
      Effect.gen(function* () {
        const result = yield* client.status();
        output({ ok: true, ...result });
      }),
    ),
  ),
);

// shutdown
const shutdownCommand = Command.make("shutdown").pipe(
  Command.withHandler(() =>
    withClient((client) =>
      Effect.gen(function* () {
        yield* client.shutdown();
        output({ ok: true, message: "Daemon shutting down" });
      }),
    ),
  ),
);

// =============================================================================
// Main CLI Application
// =============================================================================

const cli = Command.make("amfs").pipe(
  Command.withDescription(
    "Automerge Filesystem CLI - Effect RPC client for automerge-fsd daemon",
  ),
  Command.withSubcommands([
    readCommand,
    writeCommand,
    appendCommand,
    statCommand,
    lsCommand,
    mkdirCommand,
    rmCommand,
    mvCommand,
    cpCommand,
    existsCommand,
    bashCommand,
    snapshotCommand,
    historyCommand,
    diffCommand,
    headsCommand,
    statusCommand,
    shutdownCommand,
  ]),
);

// Run the CLI
const program = Effect.suspend(() => {
  const args = Bun.argv.slice(2);
  return Command.run(cli, { name: "amfs", version: "1.0.0" })(args);
}).pipe(
  Effect.provide(NodeContext.layer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      const message = error instanceof Error ? error.message : String(error);
      output({ ok: false, error: message });
      process.exit(1);
    }),
  ),
);

NodeRuntime.runMain(program);
