/**
 * Error hierarchy for automerge-fs using Effect.ts Data.TaggedError
 *
 * These errors are typed and pattern-matchable, providing better
 * error handling than thrown exceptions.
 */

import { Data } from "effect"

// =============================================================================
// File System Errors
// =============================================================================

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly path: string
}> {}

export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class DirectoryNotFoundError extends Data.TaggedError("DirectoryNotFoundError")<{
  readonly path: string
}> {}

export class DirectoryReadError extends Data.TaggedError("DirectoryReadError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class DirectoryCreateError extends Data.TaggedError("DirectoryCreateError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class FileDeleteError extends Data.TaggedError("FileDeleteError")<{
  readonly path: string
  readonly cause: unknown
}> {}

export class FileStatError extends Data.TaggedError("FileStatError")<{
  readonly path: string
  readonly cause: unknown
}> {}

// =============================================================================
// Connection Errors
// =============================================================================

export class ConnectionClosedError extends Data.TaggedError("ConnectionClosedError")<{
  readonly reason?: string
}> {}

export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  readonly socketPath: string
  readonly cause: unknown
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// =============================================================================
// Bash Execution Errors
// =============================================================================

export class BashExecutionError extends Data.TaggedError("BashExecutionError")<{
  readonly command: string
  readonly exitCode: number
  readonly stderr: string
}> {}

export class BashTimeoutError extends Data.TaggedError("BashTimeoutError")<{
  readonly command: string
  readonly timeout: number
}> {}

// =============================================================================
// RPC Errors
// =============================================================================

export class RpcError extends Data.TaggedError("RpcError")<{
  readonly method: string
  readonly cause: unknown
}> {}

export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly method: string
  readonly timeout: number
}> {}

// =============================================================================
// Initialization Errors
// =============================================================================

export class InitializationError extends Data.TaggedError("InitializationError")<{
  readonly component: string
  readonly cause: unknown
}> {}

// =============================================================================
// Union Types for Error Handling
// =============================================================================

export type FileSystemError =
  | FileNotFoundError
  | FileReadError
  | FileWriteError
  | DirectoryNotFoundError
  | DirectoryReadError
  | DirectoryCreateError
  | FileDeleteError
  | FileStatError

export type NetworkError =
  | ConnectionClosedError
  | ConnectionError
  | TransportError

export type ExecutionError =
  | BashExecutionError
  | BashTimeoutError

export type AmfsError =
  | FileSystemError
  | NetworkError
  | ExecutionError
  | RpcError
  | RpcTimeoutError
  | InitializationError
