/**
 * BashExecutor service for Effect.ts
 *
 * Provides bash command execution with typed errors
 * and proper resource management.
 */

import { Context, Effect, Layer } from "effect"
import { BashExecutionError } from "../errors"
import type { BashResult } from "../rpc/schema"

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
// Live Implementation
// =============================================================================

export interface BashExecutorConfig {
  // The fs instance is needed for just-bash integration
  fs: unknown
}

interface BashInstance {
  exec(command: string, options?: { cwd?: string }): Promise<{
    stdout: string
    stderr: string
    exitCode: number
  }>
}

/**
 * Creates the BashExecutor service layer.
 *
 * Uses just-bash for command execution with the AutomergeFs
 * as the backing filesystem.
 */
export const BashExecutorLive = (config: BashExecutorConfig) =>
  Layer.effect(
    BashExecutor,
    Effect.promise(async () => {
      const { Bash } = await import("just-bash") as { Bash: new (opts: { fs: unknown }) => BashInstance }
      const bash = new Bash({ fs: config.fs })
      return makeBashExecutorServiceFromInstance(bash)
    })
  )

/**
 * Creates a BashExecutor service from an existing Bash instance.
 * Useful for direct instantiation in the daemon.
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
