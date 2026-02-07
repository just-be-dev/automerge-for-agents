# Agent Harness Example

This example demonstrates how to build AI agents using Effect's AI package (`@effect/ai`) with the Automerge filesystem MCP tools.

## Overview

The agent harness shows how to:

1. **Wire AI agents to MCP tools** - Connect Effect's `Chat` and `LanguageModel` to the `AutomergeToolkit`
2. **Build conversational agents** - Create agents that maintain context across multiple turns
3. **Integrate with Effect layers** - Properly compose services for dependency injection
4. **Use Anthropic Claude** - Connect to Claude via `@effect/ai-anthropic`

## Quick Start

### Run the Demo

The easiest way to try the agent harness is to run the included demo:

```bash
# Set your Anthropic API key
export ANTHROPIC_API_KEY=your-api-key-here

# Run the demo
mise run demo:agent
```

This will run a multi-turn conversation where the agent:
1. Creates a directory
2. Creates a file with content
3. Reads the file back
4. Creates a snapshot

### Basic Usage

```typescript
import { Chat } from "@effect/ai"
import { Effect } from "effect"
import { AutomergeFs } from "../services/AutomergeFs"
import { BashExecutor } from "../services/BashExecutor"
import { AutomergeToolkit } from "../mcp/tools"

const program = Effect.gen(function* () {
  // Get filesystem services
  const fs = yield* AutomergeFs
  const bash = yield* BashExecutor

  // Create tool handlers
  const handlers = AutomergeToolkit.of({
    read_file: ({ path }) => fs.readFile(path).pipe(/* ... */),
    write_file: ({ path, content }) => fs.writeFile(path, content).pipe(/* ... */),
    // ... other handlers
  })

  // Create toolkit layer
  const toolkitLayer = AutomergeToolkit.toLayer(handlers)

  // Create chat and generate response
  const chat = yield* Chat.empty
  const response = yield* chat.generateText({
    prompt: "Create a file at /hello.txt",
    toolkit: toolkitLayer,
  }).pipe(Effect.provide(toolkitLayer))

  console.log(response.text)
})
```

### With Anthropic Claude

The example includes a working integration with Anthropic Claude:

```typescript
import { NodeRuntime, NodeHttpClient } from "@effect/platform-node"
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { Layer, Redacted } from "effect"
import { basicAgentExample, ExampleLayer } from "./agent-harness"

// Create the Anthropic layer
const AnthropicLayer = AnthropicLanguageModel.layer({
  model: "claude-sonnet-4-5",
}).pipe(
  Layer.provide(
    AnthropicClient.layer({
      apiKey: Redacted.make(process.env.ANTHROPIC_API_KEY ?? ""),
    }),
  ),
  Layer.provide(NodeHttpClient.layer),
)

// Compose all layers and run
const program = basicAgentExample.pipe(
  Effect.provide(
    Layer.mergeAll(AnthropicLayer, ExampleLayer(".data/agent-demo")),
  ),
)

NodeRuntime.runMain(program)
```

## Architecture

The agent harness connects multiple layers:

```
┌─────────────────────────────────────────┐
│         Your Application                 │
│                                          │
│  ┌────────────┐    ┌──────────────┐     │
│  │   Chat     │───▶│ LanguageModel│     │
│  │  (Agent)   │    │  (LLM API)   │     │
│  └─────┬──────┘    └──────────────┘     │
│        │                                 │
│        │ toolkit layer                   │
│        ▼                                 │
│  ┌──────────────────┐                    │
│  │ AutomergeToolkit │                    │
│  │   (with Layer)   │                    │
│  └─────────┬────────┘                    │
│            │                             │
│            │ handlers                    │
│            ▼                             │
│  ┌───────────────────┐                   │
│  │ Filesystem Tools  │                   │
│  │ read, write, etc. │                   │
│  └─────────┬─────────┘                   │
└───────────┼──────────────────────────────┘
            │
            ▼
   ┌────────────────┐
   │ Automerge FS   │
   │ (CRDT Storage) │
   └────────────────┘
```

## Key Concepts

### Toolkit with Handlers

The `AutomergeToolkit` defines MCP tool schemas. You attach handlers using `toLayer`:

```typescript
const handlers = AutomergeToolkit.of({
  read_file: ({ path }) => fs.readFile(path),
  write_file: ({ path, content }) => fs.writeFile(path, content),
  // ... other handlers
})

const toolkitLayer = AutomergeToolkit.toLayer(handlers)
```

This creates a Layer that the Chat service can use to execute tool calls.

### Effect Layers

The example uses Effect's Layer system for dependency injection:

- `DaemonLive` - Provides AutomergeFs and BashExecutor services
- `ExampleLayer` - Composes the daemon layer with configuration
- `LanguageModelLayer` - Provides the LLM implementation (from a provider package)

### Chat Service

The `Chat` service from `@effect/ai` maintains conversation history:

```typescript
const chat = yield* Chat.empty

// Turn 1
yield* chat.generateText({
  prompt: "Create a file",
  toolkit: toolkitLayer,
}).pipe(Effect.provide(toolkitLayer))

// Turn 2 - history is maintained
yield* chat.generateText({
  prompt: "Now read it",
  toolkit: toolkitLayer,
}).pipe(Effect.provide(toolkitLayer))
```

## Files

- **`agent-harness.ts`** - Main example implementation
- **`README.md`** - This file

## Next Steps

1. **Choose an LLM provider** - You'll need a provider package for `@effect/ai`
2. **Configure your API keys** - Set up environment variables
3. **Run the example** - Use `basicAgentExample` as a starting point
4. **Build your own agent** - Extend the example for your use case

## Learn More

- [Effect AI Documentation](https://effect.website/docs/ai/introduction)
- [Effect Platform Guide](https://effect.website/docs/platform/introduction)
- [Automerge Documentation](https://automerge.org/docs/hello/)
- [MCP Specification](https://modelcontextprotocol.io/introduction)

## Common Patterns

### System Prompts

```typescript
const chat = yield* Chat.fromPrompt("You are a helpful filesystem assistant.")
```

### Error Handling

```typescript
const response = yield* chat.generateText({
  prompt: "Create a file",
  toolkit: toolkitLayer,
}).pipe(
  Effect.provide(toolkitLayer),
  Effect.catchAll((error) => {
    console.error("Agent failed:", error)
    return Effect.succeed({ text: "Error occurred" })
  }),
)
```

### Export/Import Conversations

```typescript
// Export
const chatJson = yield* chat.exportJson

// Import
const restoredChat = yield* Chat.fromJson(chatJson)
```
