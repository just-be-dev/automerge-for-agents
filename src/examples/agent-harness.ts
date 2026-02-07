/**
 * Agent Harness Example
 *
 * Demonstrates how to wire up an AI agent using @effect/ai's Chat and
 * LanguageModel interfaces with the AutomergeToolkit from the MCP server.
 */

import { Chat } from "@effect/ai";
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { Effect, Layer, Logger, Redacted } from "effect";
import { NodeHttpClient, NodeRuntime } from "@effect/platform-node";
import { DaemonConfig, DaemonLive } from "../daemon/Layer";
import { AutomergeFs } from "../services/AutomergeFs";
import { BashExecutor } from "../services/BashExecutor";
import { AutomergeToolkit } from "../mcp/tools";
import { createHandlers } from "../mcp/server";

const logTurn = (
  label: string,
  turn: { text: string; toolCalls: Array<{ name: string }>; toolResults: Array<{ result: unknown }> },
) =>
  Effect.gen(function* () {
    yield* Effect.log(`=== ${label} ===`);
    yield* Effect.log(`Agent: ${turn.text || "(no text response)"}`);
    yield* Effect.log(`Tool calls: ${turn.toolCalls.length}`);
    if (turn.toolCalls.length > 0) {
      yield* Effect.log(`  Tools used: ${turn.toolCalls.map((tc) => tc.name).join(", ")}`);
    }
    if (turn.toolResults.length > 0) {
      yield* Effect.log(`  Results: ${turn.toolResults.length} tool results`);
    }
  });

/**
 * Example: Basic agent interaction with Automerge filesystem
 *
 * This demonstrates how to create a chat agent that can use the Automerge
 * filesystem tools to read, write, and manage files.
 */
export const basicAgentExample = Effect.gen(function* () {
  // Create a new chat session
  const chat = yield* Chat.empty;

  // First interaction: Create a file
  // The toolkit is provided via Effect context from HandlersLayer
  const response1 = yield* chat.generateText({
    prompt:
      "Create a file at /hello.txt with the content 'Hello from the agent harness!'",
    toolkit: AutomergeToolkit,
  });

  yield* Effect.log(`Agent Response 1: ${response1.text}`);

  return {
    response: response1,
  };
});

/**
 * Example: Multi-turn conversation
 *
 * Demonstrates maintaining context across multiple agent interactions
 */
export const conversationExample = Effect.gen(function* () {
  const chat = yield* Chat.fromPrompt(
    "You are a helpful filesystem assistant. Be concise in your responses.",
  );

  const turn1 = yield* chat.generateText({
    prompt: "Create a directory at /workspace/demo",
    toolkit: AutomergeToolkit,
  });
  yield* logTurn("Turn 1: Create a directory", turn1);

  const turn2 = yield* chat.generateText({
    prompt:
      "Now create a file in that directory called notes.txt with some example content",
    toolkit: AutomergeToolkit,
  });
  yield* logTurn("Turn 2: Create a file", turn2);

  const turn3 = yield* chat.generateText({
    prompt: "Read the file you just created and tell me what it says",
    toolkit: AutomergeToolkit,
  });
  yield* logTurn("Turn 3: Read it back", turn3);
  if (turn3.toolResults.length > 0) {
    yield* Effect.log(`  File content: ${turn3.toolResults[0]?.result}`);
  }

  const turn4 = yield* chat.generateText({
    prompt: "Create a snapshot called 'demo-complete'",
    toolkit: AutomergeToolkit,
  });
  yield* logTurn("Turn 4: Create a snapshot", turn4);

  const totalToolCalls = [turn1, turn2, turn3, turn4].reduce(
    (sum, turn) => sum + turn.toolCalls.length,
    0,
  );
  yield* Effect.log(`Demo complete! Total tool calls: ${totalToolCalls}`);

  return { turns: [turn1, turn2, turn3, turn4] };
});

/**
 * Creates a layer that provides all necessary dependencies for running
 * the agent examples.
 */
export const ExampleLayer = (dataDir: string) => {
  const ConfigLayer = Layer.succeed(DaemonConfig, {
    socketPath: "",
    dataDir,
  });

  // Create the handlers layer
  const HandlersLayer = AutomergeToolkit.toLayer(
    Effect.gen(function* () {
      const fs = yield* AutomergeFs;
      const bash = yield* BashExecutor;
      return createHandlers(fs, bash);
    }),
  );

  return HandlersLayer.pipe(
    Layer.provide(DaemonLive),
    Layer.provide(ConfigLayer),
  );
};

/**
 * Creates the Anthropic language model layer
 */
export const AnthropicLayer = AnthropicLanguageModel.layer({
  model: "claude-sonnet-4-5",
}).pipe(
  Layer.provide(
    AnthropicClient.layer({
      apiKey: Redacted.make(process.env.ANTHROPIC_API_KEY ?? ""),
    }),
  ),
  Layer.provide(NodeHttpClient.layer),
);

/**
 * Main program - runs the conversation example
 */
export const runDemo = conversationExample.pipe(
  Effect.catchAll((error) =>
    Effect.logError("Error").pipe(Effect.annotateLogs("error", String(error))),
  ),
  Effect.provide(
    Layer.mergeAll(AnthropicLayer, ExampleLayer(".data/agent-demo")),
  ),
  Effect.provide(Logger.pretty),
);

/**
 * Entry point when running as a script
 */
if (import.meta.main) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable is not set");
    process.exit(1);
  }

  // Suppress harmless TimeoutNegativeWarning from Effect's pool TTL calculation
  // (upstream issue in effect/src/internal/pool.ts strategyCreationTTL)
  process.on("warning", (warning) => {
    if (warning.name === "TimeoutNegativeWarning") return;
    console.warn(warning);
  });

  NodeRuntime.runMain(runDemo);
}
