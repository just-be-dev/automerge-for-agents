/**
 * Blob storage implementations
 *
 * Provides blob storage backends for Automerge filesystem.
 */

import { Context, Effect, Layer } from "effect"
import { readdir, unlink, mkdir } from "node:fs/promises"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DaemonConfig } from "../daemon/DaemonConfig"

export interface BlobStore {
  get(hash: string): Promise<Uint8Array | null>
  set(hash: string, data: Uint8Array): Promise<void>
  has(hash: string): Promise<boolean>
  delete(hash: string): Promise<void>
  list(): Promise<string[]>
}

/**
 * Filesystem-based blob store
 *
 * Stores blobs as files on disk, using a two-level directory structure
 * for better filesystem performance (first 2 chars of hash as subdirectory).
 */
export class FileSystemBlobStore implements BlobStore {
  constructor(private basePath: string) {}

  private getPath(hash: string): string {
    if (hash.length < 2) {
      return join(this.basePath, "00", hash)
    }
    const dir = hash.substring(0, 2)
    const filename = hash.substring(2)
    return join(this.basePath, dir, filename)
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const path = this.getPath(hash)
    const file = Bun.file(path)
    if (!(await file.exists())) {
      return null
    }
    return new Uint8Array(await file.arrayBuffer())
  }

  async set(hash: string, data: Uint8Array): Promise<void> {
    const path = this.getPath(hash)
    const dir = hash.length < 2 ? join(this.basePath, "00") : join(this.basePath, hash.substring(0, 2))
    await mkdir(dir, { recursive: true })
    await Bun.write(path, data)
  }

  async has(hash: string): Promise<boolean> {
    const path = this.getPath(hash)
    return await Bun.file(path).exists()
  }

  async delete(hash: string): Promise<void> {
    const path = this.getPath(hash)
    const file = Bun.file(path)
    if (await file.exists()) {
      await unlink(path)
    }
  }

  async list(): Promise<string[]> {
    const hashes: string[] = []

    try {
      const subdirs = await readdir(this.basePath, { withFileTypes: true })

      for (const entry of subdirs) {
        if (entry.isDirectory()) {
          const files = await readdir(join(this.basePath, entry.name))
          for (const file of files) {
            hashes.push(entry.name + file)
          }
        }
      }
    } catch (e) {
      // Directory doesn't exist yet, return empty array
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e
      }
    }

    return hashes
  }
}

export class BlobStoreTag extends Context.Tag("BlobStore")<BlobStoreTag, BlobStore>() {}

/**
 * BlobStoreLive — reads DaemonConfig, creates FileSystemBlobStore
 */
export const BlobStoreLive = Layer.effect(
  BlobStoreTag,
  Effect.gen(function* () {
    const config = yield* DaemonConfig
    const dir = join(config.dataDir, "blobs")
    mkdirSync(dir, { recursive: true })
    return new FileSystemBlobStore(dir)
  })
)
