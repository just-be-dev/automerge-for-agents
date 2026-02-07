/**
 * MCP tool definitions for automerge-fs
 *
 * Defines tools using @effect/ai Tool.make() and groups them into an
 * AutomergeToolkit via Toolkit.make().
 */

import { Tool, Toolkit } from "@effect/ai"
import { Schema } from "effect"

// =============================================================================
// Tool Definitions
// =============================================================================

export const ReadFileTool = Tool.make("read_file", {
  description:
    "Read file content from the Automerge filesystem (returns UTF-8 text or base64 for binary)",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path to the file",
    }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const WriteFileTool = Tool.make("write_file", {
  description: "Write content to a file in the Automerge filesystem",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path to the file",
    }),
    content: Schema.String.annotations({ description: "Content to write" }),
    encoding: Schema.optional(
      Schema.Literal("utf-8", "base64").annotations({
        description: "Content encoding (default: utf-8)",
      }),
    ),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const ListDirectoryTool = Tool.make("list_directory", {
  description: "List entries in a directory",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path to the directory",
    }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const CreateDirectoryTool = Tool.make("create_directory", {
  description: "Create a directory (optionally recursive)",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path for the new directory",
    }),
    recursive: Schema.optional(
      Schema.Boolean.annotations({
        description: "Create parent directories if needed",
      }),
    ),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const RemoveTool = Tool.make("remove", {
  description: "Remove a file from the filesystem",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path to the file to remove",
    }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const StatTool = Tool.make("stat", {
  description: "Get file or directory metadata (size, type, timestamps)",
  parameters: {
    path: Schema.String.annotations({ description: "Absolute path to stat" }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const ExistsTool = Tool.make("exists", {
  description: "Check whether a path exists in the filesystem",
  parameters: {
    path: Schema.String.annotations({
      description: "Absolute path to check",
    }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const MoveTool = Tool.make("move", {
  description: "Rename or move a file",
  parameters: {
    oldPath: Schema.String.annotations({ description: "Current path" }),
    newPath: Schema.String.annotations({ description: "Destination path" }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const CopyTool = Tool.make("copy", {
  description: "Copy a file",
  parameters: {
    src: Schema.String.annotations({ description: "Source path" }),
    dest: Schema.String.annotations({ description: "Destination path" }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const BashTool = Tool.make("bash", {
  description:
    "Execute a bash command inside the virtual Automerge filesystem",
  parameters: {
    command: Schema.String.annotations({
      description: "Bash command to execute",
    }),
    cwd: Schema.optional(
      Schema.String.annotations({
        description: "Working directory (default: /)",
      }),
    ),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const SnapshotTool = Tool.make("snapshot", {
  description:
    "Capture current filesystem state (returns Automerge head hashes)",
  parameters: {
    name: Schema.optional(
      Schema.String.annotations({ description: "Optional snapshot label" }),
    ),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const HistoryTool = Tool.make("history", {
  description: "View change history for a file or the root document",
  parameters: {
    path: Schema.optional(
      Schema.String.annotations({
        description: "File path (omit for root history)",
      }),
    ),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

export const DiffTool = Tool.make("diff", {
  description: "Diff a file between two versions (Automerge head hashes)",
  parameters: {
    path: Schema.String.annotations({ description: "File path to diff" }),
    fromHeads: Schema.Array(Schema.String).annotations({
      description: "Starting version heads",
    }),
    toHeads: Schema.Array(Schema.String).annotations({
      description: "Ending version heads",
    }),
  },
  success: Schema.String,
  failure: Schema.String,
  failureMode: "return",
})

// =============================================================================
// Toolkit
// =============================================================================

export const AutomergeToolkit = Toolkit.make(
  ReadFileTool,
  WriteFileTool,
  ListDirectoryTool,
  CreateDirectoryTool,
  RemoveTool,
  StatTool,
  ExistsTool,
  MoveTool,
  CopyTool,
  BashTool,
  SnapshotTool,
  HistoryTool,
  DiffTool,
)
