/**
 * Layer composition for automerge-fsd
 *
 * Composes all services into a single layer that can be
 * provided to the daemon runtime.
 */

import { Effect } from "effect"
import { Repo } from "@automerge/automerge-repo"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { AutomergeFsMultiDoc, type AutomergeFsService } from "../services/AutomergeFs"
import { FileSystemBlobStore } from "../services/BlobStore"
import { Bash } from "just-bash"
import type { BashExecutorService } from "../services/BashExecutor"
import {
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  DirectoryReadError,
  DirectoryCreateError,
  FileDeleteError,
  FileStatError,
  BashExecutionError,
} from "../errors"

// =============================================================================
// Configuration
// =============================================================================

export interface DaemonConfig {
  socketPath: string
  dataDir: string
}

// =============================================================================
// Daemon Initialization
// =============================================================================

/**
 * Creates the daemon services with proper initialization.
 *
 * This initializes the Automerge filesystem and bash executor.
 */
export const initializeDaemonServices = async (config: DaemonConfig) => {
  const { dataDir } = config

  // Ensure directories exist
  mkdirSync(join(dataDir, "automerge"), { recursive: true })
  mkdirSync(join(dataDir, "blobs"), { recursive: true })

  // Initialize components
  const repo = new Repo({})
  const blobStore = new FileSystemBlobStore(join(dataDir, "blobs"))
  const fs = await AutomergeFsMultiDoc.create({ repo, blobStore })

  // Create the AutomergeFs service wrapper
  const fsService = createAutomergeFsServiceFromInstance(fs)

  // Create BashExecutor with the fs instance
  // Note: just-bash expects a full IFileSystem interface, but we provide a subset
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bash = new Bash({ fs: fs as any })
  const bashService = createBashExecutorServiceFromInstance(bash)

  return {
    fsService,
    bashService,
    rawFs: fs,
    rawBash: bash,
  }
}

// =============================================================================
// Service Factory Functions
// =============================================================================

/**
 * Creates an AutomergeFsService from an existing AutomergeFsMultiDoc instance.
 */
function createAutomergeFsServiceFromInstance(fs: AutomergeFsMultiDoc): AutomergeFsService {
  return {
    readFile: (path: string) =>
      Effect.tryPromise({
        try: () => fs.readFile(path),
        catch: (e) => {
          const err = e as Error
          if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
            return new FileNotFoundError({ path })
          }
          return new FileReadError({ path, cause: e })
        },
      }),

    writeFile: (path: string, content: string | Uint8Array) =>
      Effect.tryPromise({
        try: () => fs.writeFile(path, content),
        catch: (e) => new FileWriteError({ path, cause: e }),
      }),

    appendFile: (path: string, content: string) =>
      Effect.tryPromise({
        try: () => fs.appendFile(path, content),
        catch: (e) => new FileWriteError({ path, cause: e }),
      }),

    stat: (path: string) =>
      Effect.tryPromise({
        try: async () => {
          const s = await fs.stat(path)
          return {
            size: s.size,
            isFile: s.isFile,
            isDirectory: s.isDirectory,
            isSymbolicLink: s.isSymbolicLink,
            mode: s.mode,
            mtime: s.mtime.toISOString(),
            ctime: s.ctime.toISOString(),
          }
        },
        catch: (e) => {
          const err = e as Error
          if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
            return new FileNotFoundError({ path })
          }
          return new FileStatError({ path, cause: e })
        },
      }),

    readdir: (path: string) =>
      Effect.tryPromise({
        try: () => fs.readdir(path) as Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }>>,
        catch: (e) => new DirectoryReadError({ path, cause: e }),
      }),

    mkdir: (path: string, options?: { recursive?: boolean }) =>
      Effect.tryPromise({
        try: () => fs.mkdir(path, options),
        catch: (e) => new DirectoryCreateError({ path, cause: e }),
      }),

    unlink: (path: string) =>
      Effect.tryPromise({
        try: () => fs.unlink(path),
        catch: (e) => {
          const err = e as Error
          if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
            return new FileNotFoundError({ path })
          }
          return new FileDeleteError({ path, cause: e })
        },
      }),

    exists: (path: string) =>
      Effect.tryPromise({
        try: () => fs.exists(path),
        catch: () => false,
      }).pipe(Effect.catchAll(() => Effect.succeed(false))),

    rename: (oldPath: string, newPath: string) =>
      Effect.gen(function* () {
        const content = yield* Effect.tryPromise({
          try: () => fs.readFile(oldPath),
          catch: (e) => {
            const err = e as Error
            if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
              return new FileNotFoundError({ path: oldPath })
            }
            return new FileReadError({ path: oldPath, cause: e })
          },
        })
        yield* Effect.tryPromise({
          try: () => fs.writeFile(newPath, content),
          catch: (e) => new FileWriteError({ path: newPath, cause: e }),
        })
        yield* Effect.tryPromise({
          try: () => fs.unlink(oldPath),
          catch: (e) => new FileDeleteError({ path: oldPath, cause: e }),
        })
      }),

    copy: (src: string, dest: string) =>
      Effect.gen(function* () {
        const content = yield* Effect.tryPromise({
          try: () => fs.readFile(src),
          catch: (e) => {
            const err = e as Error
            if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
              return new FileNotFoundError({ path: src })
            }
            return new FileReadError({ path: src, cause: e })
          },
        })
        yield* Effect.tryPromise({
          try: () => fs.writeFile(dest, content),
          catch: (e) => new FileWriteError({ path: dest, cause: e }),
        })
      }),

    getRootHeads: () =>
      Effect.sync(() => {
        const heads = fs.getRootHeads()
        return heads.map(String)
      }),

    getFileHistory: (path: string) =>
      Effect.tryPromise({
        try: () => fs.getFileHistory(path),
        catch: () => [] as unknown[],
      }).pipe(Effect.catchAll(() => Effect.succeed([] as unknown[]))),

    getFileAt: (path: string, heads: string[]) =>
      Effect.tryPromise({
        try: () => fs.getFileAt(path, heads),
        catch: () => "",
      }).pipe(Effect.catchAll(() => Effect.succeed(""))),

    getRootDoc: () =>
      Effect.tryPromise({
        try: async () => {
          const doc = await fs.rootHandle.doc()
          return doc ?? null
        },
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.succeed(null))),

    getAllDocumentIds: () =>
      Effect.tryPromise({
        try: () => fs.getAllDocumentIds(),
        catch: () => [] as string[],
      }).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),

    getAllBlobHashes: () =>
      Effect.tryPromise({
        try: () => fs.getAllBlobHashes(),
        catch: () => [] as string[],
      }).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),
  }
}

/**
 * Creates a BashExecutorService from an existing Bash instance.
 */
function createBashExecutorServiceFromInstance(bash: InstanceType<typeof Bash>): BashExecutorService {
  return {
    exec: (command: string, options?: { cwd?: string }) =>
      Effect.tryPromise({
        try: async () => {
          const result = await bash.exec(command, options)
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }
        },
        catch: (e) => {
          const err = e as { exitCode?: number; stderr?: string }
          return new BashExecutionError({
            command,
            exitCode: err.exitCode ?? 1,
            stderr: err.stderr ?? String(e),
          })
        },
      }),
  }
}
