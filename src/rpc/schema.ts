/**
 * RPC Schema definitions for automerge-fs
 *
 * Defines request/response types using Effect Schema for
 * typed, validated RPC communication.
 */

import { Schema } from "effect"

// =============================================================================
// Shared Schemas
// =============================================================================

export const FileStatSchema = Schema.Struct({
  size: Schema.Number,
  isFile: Schema.Boolean,
  isDirectory: Schema.Boolean,
  isSymbolicLink: Schema.Boolean,
  mode: Schema.Number,
  mtime: Schema.String,
  ctime: Schema.String,
})

export type FileStat = typeof FileStatSchema.Type

export const DirEntrySchema = Schema.Struct({
  name: Schema.String,
  isFile: Schema.Boolean,
  isDirectory: Schema.Boolean,
  isSymbolicLink: Schema.Boolean,
})

export type DirEntry = typeof DirEntrySchema.Type

export const ReadResultSchema = Schema.Struct({
  content: Schema.String,
  encoding: Schema.Literal("utf-8", "base64"),
})

export type ReadResult = typeof ReadResultSchema.Type

export const BashResultSchema = Schema.Struct({
  stdout: Schema.String,
  stderr: Schema.String,
  exitCode: Schema.Number,
})

export type BashResult = typeof BashResultSchema.Type

export const SnapshotResultSchema = Schema.Struct({
  heads: Schema.Array(Schema.String),
  name: Schema.NullOr(Schema.String),
  timestamp: Schema.Number,
})

export type SnapshotResult = typeof SnapshotResultSchema.Type

export const FileHistoryResultSchema = Schema.Struct({
  type: Schema.Literal("file"),
  path: Schema.String,
  history: Schema.Array(Schema.Unknown),
})

export const RootHistoryResultSchema = Schema.Struct({
  type: Schema.Literal("root"),
  operationLog: Schema.Array(Schema.Unknown),
})

export const HistoryResultSchema = Schema.Union(
  FileHistoryResultSchema,
  RootHistoryResultSchema
)

export type HistoryResult = typeof HistoryResultSchema.Type

export const MemoryInfoSchema = Schema.Struct({
  heapUsed: Schema.Number,
  heapTotal: Schema.Number,
  rss: Schema.Number,
})

export const ServiceStatusSchema = Schema.Struct({
  pid: Schema.Number,
  runtime: Schema.String,
  version: Schema.String,
  uptime: Schema.Number,
  dataDir: Schema.String,
  documents: Schema.Number,
  blobs: Schema.Number,
  memory: MemoryInfoSchema,
})

export type ServiceStatus = typeof ServiceStatusSchema.Type

// =============================================================================
// RPC Message Schema
// =============================================================================

export const RpcRequestSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.Unknown,
})

export type RpcRequest = typeof RpcRequestSchema.Type

export const RpcResponseSchema = Schema.Struct({
  id: Schema.Number,
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({
    message: Schema.String,
    code: Schema.optional(Schema.String),
  })),
})

export type RpcResponse = typeof RpcResponseSchema.Type

// =============================================================================
// Method Parameter Schemas
// =============================================================================

export const ReadParams = Schema.Struct({ path: Schema.String })
export const WriteParams = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  encoding: Schema.optional(Schema.Literal("utf-8", "base64")),
})
export const AppendParams = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})
export const StatParams = Schema.Struct({ path: Schema.String })
export const ReaddirParams = Schema.Struct({ path: Schema.String })
export const MkdirParams = Schema.Struct({
  path: Schema.String,
  recursive: Schema.optional(Schema.Boolean),
})
export const RmParams = Schema.Struct({ path: Schema.String })
export const ExistsParams = Schema.Struct({ path: Schema.String })
export const RenameParams = Schema.Struct({
  oldPath: Schema.String,
  newPath: Schema.String,
})
export const CopyParams = Schema.Struct({
  src: Schema.String,
  dest: Schema.String,
})
export const BashParams = Schema.Struct({
  command: Schema.String,
  cwd: Schema.optional(Schema.String),
})
export const SnapshotParams = Schema.Struct({
  name: Schema.optional(Schema.String),
})
export const HistoryParams = Schema.Struct({
  path: Schema.optional(Schema.String),
})
export const GetFileAtParams = Schema.Struct({
  path: Schema.String,
  heads: Schema.Array(Schema.String),
})
export const StatusParams = Schema.Struct({})
export const ShutdownParams = Schema.Struct({})

// =============================================================================
// Method Parameter Types
// =============================================================================

export type ReadParamsType = typeof ReadParams.Type
export type WriteParamsType = typeof WriteParams.Type
export type AppendParamsType = typeof AppendParams.Type
export type StatParamsType = typeof StatParams.Type
export type ReaddirParamsType = typeof ReaddirParams.Type
export type MkdirParamsType = typeof MkdirParams.Type
export type RmParamsType = typeof RmParams.Type
export type ExistsParamsType = typeof ExistsParams.Type
export type RenameParamsType = typeof RenameParams.Type
export type CopyParamsType = typeof CopyParams.Type
export type BashParamsType = typeof BashParams.Type
export type SnapshotParamsType = typeof SnapshotParams.Type
export type HistoryParamsType = typeof HistoryParams.Type
export type GetFileAtParamsType = typeof GetFileAtParams.Type
export type StatusParamsType = typeof StatusParams.Type
export type ShutdownParamsType = typeof ShutdownParams.Type
