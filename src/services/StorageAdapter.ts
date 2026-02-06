import { Context, Effect, Layer } from "effect"
import type { StorageAdapterInterface } from "@automerge/automerge-repo"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { DaemonConfig } from "../daemon/DaemonConfig"

export class StorageAdapter extends Context.Tag("StorageAdapter")<
  StorageAdapter,
  StorageAdapterInterface
>() {}

/**
 * StorageAdapterLive — reads DaemonConfig, creates NodeFSStorageAdapter
 */
export const StorageAdapterLive = Layer.effect(
  StorageAdapter,
  Effect.gen(function* () {
    const config = yield* DaemonConfig
    const dir = join(config.dataDir, "automerge")
    mkdirSync(dir, { recursive: true })
    return new NodeFSStorageAdapter(dir)
  })
)
