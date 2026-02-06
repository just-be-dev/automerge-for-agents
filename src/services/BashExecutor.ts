/**
 * BashExecutor service for Effect.ts
 *
 * Provides bash command execution with typed errors
 * and proper resource management.
 */

import { Context, Effect, Layer } from "effect"
import { Bash, type IFileSystem } from "just-bash"
import { BashExecutionError } from "../errors"
import type { BashResult } from "../rpc/schema"
import { AutomergeFsInstance, type AutomergeFsMultiDoc } from "./AutomergeFs"

// =============================================================================
// Service Interface
// =============================================================================

export interface BashExecutorService {
  readonly exec: (
    command: string,
    options?: { cwd?: string }
  ) => Effect.Effect<BashResult, BashExecutionError>
}

export class BashExecutor extends Context.Tag("BashExecutor")<
  BashExecutor,
  BashExecutorService
>() {}

// =============================================================================
// Service Factory
// =============================================================================

interface BashInstance {
  exec(command: string, options?: { cwd?: string }): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>
}

/**
 * Creates a BashExecutor service from an existing Bash instance.
 * Used by BashExecutorLive layer in Layer.ts.
 */
export const makeBashExecutorServiceFromInstance = (bash: BashInstance): BashExecutorService => ({
  exec: (command, options) =>
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
})

// =============================================================================
// Live Layer
// =============================================================================

/**
 * Adapts AutomergeFsMultiDoc to the IFileSystem interface expected by just-bash.
 */
function adaptToFileSystem(fs: AutomergeFsMultiDoc): IFileSystem {
  return {
    readFile: async (path: string) => {
      const bytes = await fs.readFile(path)
      return new TextDecoder().decode(bytes)
    },
    readFileBuffer: (path: string) => fs.readFile(path),
    writeFile: (path: string, content: string | Uint8Array) =>
      fs.writeFile(path, content),
    appendFile: (path: string, content: string) =>
      fs.appendFile(path, content),
    exists: (path: string) => fs.exists(path),
    stat: async (path: string) => {
      const s = await fs.stat(path)
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        mode: s.mode,
        size: s.size,
        mtime: s.mtime,
      }
    },
    mkdir: (path: string, options?: { recursive?: boolean }) =>
      fs.mkdir(path, options),
    readdir: async (path: string) => {
      const entries = await fs.readdir(path)
      return entries.map((e) => e.name)
    },
    readdirWithFileTypes: async (path: string) => {
      const entries = await fs.readdir(path)
      return entries
    },
    rm: (path: string, options?: { recursive?: boolean }) =>
      fs.rm(path, options),
    cp: (src: string, dest: string, options?: { recursive?: boolean }) =>
      fs.cp(src, dest, options),
    mv: (src: string, dest: string) => fs.mv(src, dest),
    resolvePath: (base: string, path: string) => fs.resolvePath(base, path),
    getAllPaths: () => fs.getAllPaths(),
    chmod: (path: string, mode: number) => fs.chmod(path, mode),
    symlink: (_target: string, _linkPath: string) => fs.symlink(),
    link: (_existingPath: string, _newPath: string) => fs.link(),
    readlink: (_path: string) => fs.readlink(),
    lstat: async (path: string) => {
      const s = await fs.lstat(path)
      return {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        mode: s.mode,
        size: s.size,
        mtime: s.mtime,
      }
    },
    realpath: (path: string) => fs.realpath(path),
    utimes: (path: string, atime: Date, mtime: Date) =>
      fs.utimes(path, atime.getTime(), mtime.getTime()),
  }
}

/**
 * BashExecutorLive — reads AutomergeFsInstance, creates Bash + wraps
 */
export const BashExecutorLive = Layer.effect(
  BashExecutor,
  Effect.gen(function* () {
    const fs = yield* AutomergeFsInstance
    const bash = new Bash({ fs: adaptToFileSystem(fs) })
    return makeBashExecutorServiceFromInstance(bash)
  })
)

// =============================================================================
// Simple Implementation (without just-bash)
// =============================================================================

/**
 * A simpler bash executor that uses Bun's shell directly.
 * Does not integrate with AutomergeFs.
 */
export const SimpleBashExecutorLive = Layer.succeed(
  BashExecutor,
  {
    exec: (command, options) =>
      Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(["sh", "-c", command], {
            cwd: options?.cwd,
            stdout: "pipe",
            stderr: "pipe",
          })

          const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ])

          const exitCode = await proc.exited

          return {
            stdout,
            stderr,
            exitCode,
          }
        },
        catch: (e) =>
          new BashExecutionError({
            command,
            exitCode: 1,
            stderr: String(e),
          }),
      }),
  }
)
