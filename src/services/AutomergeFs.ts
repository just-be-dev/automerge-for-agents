/**
 * AutomergeFs service for Effect.ts
 *
 * Provides file system operations backed by Automerge CRDTs
 * with typed errors and proper resource management.
 */

import { Context, Effect } from "effect"
import * as Automerge from "@automerge/automerge"
import type { Repo, DocHandle } from "@automerge/automerge-repo"
import {
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  DirectoryReadError,
  DirectoryCreateError,
  FileDeleteError,
  FileStatError,
} from "../errors"
import type { FileStat, DirEntry } from "../rpc/schema"
import type { BlobStore } from "./BlobStore"

// =============================================================================
// Document Schema
// =============================================================================

interface FsRootDoc {
  entries: Record<string, FsEntry>
}

interface FsEntry {
  type: "file" | "directory"
  path: string
  parent: string | null
  name: string
  metadata: {
    size: number
    mode: number
    mtime: number
    ctime: number
  }
  // For files only
  content?: string | null // null means stored in blob
  blobHash?: string
}

// =============================================================================
// AutomergeFsMultiDoc Implementation
// =============================================================================

export class AutomergeFsMultiDoc {
  private handle: DocHandle<FsRootDoc>
  private repo: Repo
  private blobStore: BlobStore
  private operationLog: Array<{ timestamp: number; operation: string; path: string }> = []

  private constructor(handle: DocHandle<FsRootDoc>, repo: Repo, blobStore: BlobStore) {
    this.handle = handle
    this.repo = repo
    this.blobStore = blobStore
  }

  static async create(opts: { repo: Repo; blobStore: BlobStore }): Promise<AutomergeFsMultiDoc> {
    // Create root document
    const handle = opts.repo.create<FsRootDoc>()

    handle.change((doc) => {
      if (!doc.entries) {
        doc.entries = {}
        // Create root directory
        doc.entries["/"] = {
          type: "directory",
          path: "/",
          parent: null,
          name: "/",
          metadata: {
            size: 0,
            mode: 0o755,
            mtime: Date.now(),
            ctime: Date.now(),
          },
        }
      }
    })

    return new AutomergeFsMultiDoc(handle, opts.repo, opts.blobStore)
  }

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  private normalizePath(path: string): string {
    if (path === "/") return "/"
    // Remove trailing slashes and normalize
    return path.replace(/\/+$/, "").replace(/\/+/g, "/")
  }

  private getParentPath(path: string): string {
    if (path === "/") return "/"
    const parts = path.split("/").filter((p) => p)
    if (parts.length === 1) return "/"
    return "/" + parts.slice(0, -1).join("/")
  }

  private getBasename(path: string): string {
    if (path === "/") return "/"
    const parts = path.split("/").filter((p) => p)
    return parts[parts.length - 1] ?? ""
  }

  // ===========================================================================
  // Entry Management
  // ===========================================================================

  private getEntry(path: string): FsEntry | null {
    const normalized = this.normalizePath(path)
    const doc = this.handle.docSync()
    return doc?.entries?.[normalized] ?? null
  }

  private setEntry(path: string, entry: FsEntry): void {
    const normalized = this.normalizePath(path)
    this.handle.change((doc) => {
      if (!doc.entries) {
        doc.entries = {}
      }
      doc.entries[normalized] = entry
    })
  }

  private deleteEntry(path: string): void {
    const normalized = this.normalizePath(path)
    this.handle.change((doc) => {
      if (doc.entries) {
        delete doc.entries[normalized]
      }
    })
  }

  private logOperation(operation: string, path: string): void {
    this.operationLog.push({
      timestamp: Date.now(),
      operation,
      path,
    })
  }

  // ===========================================================================
  // Filesystem Operations
  // ===========================================================================

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.getEntry(path)
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    if (entry.type !== "file") {
      throw new Error(`EISDIR: illegal operation on a directory: ${path}`)
    }

    // Check if content is in blob store
    if (entry.blobHash) {
      const blob = await this.blobStore.get(entry.blobHash)
      if (!blob) {
        throw new Error(`Blob not found: ${entry.blobHash}`)
      }
      return blob
    }

    // Content is inline
    const content = entry.content ?? ""
    return new TextEncoder().encode(content)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const normalized = this.normalizePath(path)
    const parentPath = this.getParentPath(normalized)

    // Ensure parent directory exists
    const parent = this.getEntry(parentPath)
    if (!parent || parent.type !== "directory") {
      throw new Error(`ENOENT: no such file or directory: ${parentPath}`)
    }

    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
    const size = bytes.length

    // Decide whether to store inline or in blob
    const INLINE_THRESHOLD = 1024 * 10 // 10KB
    let blobHash: string | undefined
    let inlineContent: string | null = null

    if (size > INLINE_THRESHOLD) {
      // Store in blob
      blobHash = this.createBlobHash(bytes)
      await this.blobStore.set(blobHash, bytes)
    } else {
      // Store inline
      inlineContent = typeof content === "string" ? content : new TextDecoder().decode(bytes)
    }

    const now = Date.now()
    const existing = this.getEntry(normalized)

    this.setEntry(normalized, {
      type: "file",
      path: normalized,
      parent: parentPath,
      name: this.getBasename(normalized),
      metadata: {
        size,
        mode: existing?.metadata.mode ?? 0o644,
        mtime: now,
        ctime: existing?.metadata.ctime ?? now,
      },
      content: inlineContent,
      blobHash,
    })

    this.logOperation("writeFile", normalized)
  }

  async appendFile(path: string, content: string): Promise<void> {
    const normalized = this.normalizePath(path)

    // Read existing content
    let existing: Uint8Array
    try {
      existing = await this.readFile(normalized)
    } catch {
      // File doesn't exist, create it
      await this.writeFile(normalized, content)
      return
    }

    // Append new content
    const newContent = new Uint8Array(existing.length + content.length)
    newContent.set(existing, 0)
    newContent.set(new TextEncoder().encode(content), existing.length)

    await this.writeFile(normalized, newContent)
  }

  async stat(path: string): Promise<{
    size: number
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
    mode: number
    mtime: Date
    ctime: Date
  }> {
    const entry = this.getEntry(path)
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    return {
      size: entry.metadata.size,
      isFile: entry.type === "file",
      isDirectory: entry.type === "directory",
      isSymbolicLink: false,
      mode: entry.metadata.mode,
      mtime: new Date(entry.metadata.mtime),
      ctime: new Date(entry.metadata.ctime),
    }
  }

  async readdir(path: string): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }>> {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    if (entry.type !== "directory") {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }

    const doc = this.handle.docSync()
    const entries: Array<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }> = []

    for (const [, entryData] of Object.entries(doc?.entries ?? {})) {
      if (entryData.parent === normalized) {
        entries.push({
          name: entryData.name,
          isFile: entryData.type === "file",
          isDirectory: entryData.type === "directory",
          isSymbolicLink: false,
        })
      }
    }

    return entries
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalizePath(path)

    // Check if already exists
    const existing = this.getEntry(normalized)
    if (existing) {
      if (existing.type === "directory") {
        return // Already exists, no-op
      }
      throw new Error(`EEXIST: file already exists: ${path}`)
    }

    const parentPath = this.getParentPath(normalized)

    // Check parent
    const parent = this.getEntry(parentPath)
    if (!parent) {
      if (options?.recursive) {
        // Create parent directories recursively
        await this.mkdir(parentPath, options)
      } else {
        throw new Error(`ENOENT: no such file or directory: ${parentPath}`)
      }
    } else if (parent.type !== "directory") {
      throw new Error(`ENOTDIR: not a directory: ${parentPath}`)
    }

    const now = Date.now()
    this.setEntry(normalized, {
      type: "directory",
      path: normalized,
      parent: parentPath,
      name: this.getBasename(normalized),
      metadata: {
        size: 0,
        mode: 0o755,
        mtime: now,
        ctime: now,
      },
    })

    this.logOperation("mkdir", normalized)
  }

  async unlink(path: string): Promise<void> {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    // If it's a file with a blob, delete the blob
    if (entry.type === "file" && entry.blobHash) {
      await this.blobStore.delete(entry.blobHash)
    }

    this.deleteEntry(normalized)
    this.logOperation("unlink", normalized)
  }

  async exists(path: string): Promise<boolean> {
    return this.getEntry(path) !== null
  }

  // ===========================================================================
  // Version Control
  // ===========================================================================

  getRootHeads(): unknown[] {
    const doc = this.handle.docSync()
    if (!doc) return []
    return Automerge.getHeads(doc)
  }

  async getFileHistory(path: string): Promise<unknown[]> {
    // Return operation log entries for this path
    return this.operationLog.filter((op) => op.path === path)
  }

  async getFileAt(path: string, _heads: string[]): Promise<string> {
    // This would require storing historical versions
    // For now, return current version
    try {
      const content = await this.readFile(path)
      return new TextDecoder().decode(content)
    } catch {
      return ""
    }
  }

  get rootHandle() {
    return {
      doc: async () => {
        const doc = this.handle.docSync()
        return doc ? { ...doc, operationLog: this.operationLog } : null
      },
    }
  }

  // ===========================================================================
  // Metadata
  // ===========================================================================

  async getAllDocumentIds(): Promise<string[]> {
    // Return all document IDs from the repo
    return [this.handle.url]
  }

  async getAllBlobHashes(): Promise<string[]> {
    return await this.blobStore.list()
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private createBlobHash(data: Uint8Array): string {
    // Use Bun's built-in crypto hasher
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(data)
    return hasher.digest("hex")
  }
}

// =============================================================================
// Effect Service Interface
// =============================================================================

export interface AutomergeFsService {
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, FileReadError | FileNotFoundError>

  readonly writeFile: (
    path: string,
    content: string | Uint8Array
  ) => Effect.Effect<void, FileWriteError>

  readonly appendFile: (path: string, content: string) => Effect.Effect<void, FileWriteError>

  readonly stat: (path: string) => Effect.Effect<FileStat, FileStatError | FileNotFoundError>

  readonly readdir: (path: string) => Effect.Effect<DirEntry[], DirectoryReadError>

  readonly mkdir: (
    path: string,
    options?: { recursive?: boolean }
  ) => Effect.Effect<void, DirectoryCreateError>

  readonly unlink: (path: string) => Effect.Effect<void, FileDeleteError | FileNotFoundError>

  readonly exists: (path: string) => Effect.Effect<boolean>

  readonly rename: (
    oldPath: string,
    newPath: string
  ) => Effect.Effect<void, FileReadError | FileWriteError | FileDeleteError | FileNotFoundError>

  readonly copy: (
    src: string,
    dest: string
  ) => Effect.Effect<void, FileReadError | FileWriteError | FileNotFoundError>

  // Version control
  readonly getRootHeads: () => Effect.Effect<string[]>
  readonly getFileHistory: (path: string) => Effect.Effect<unknown[]>
  readonly getFileAt: (path: string, heads: string[]) => Effect.Effect<string>
  readonly getRootDoc: () => Effect.Effect<{ operationLog?: unknown[] } | null>

  // Metadata
  readonly getAllDocumentIds: () => Effect.Effect<string[]>
  readonly getAllBlobHashes: () => Effect.Effect<string[]>
}

export class AutomergeFs extends Context.Tag("AutomergeFs")<
  AutomergeFs,
  AutomergeFsService
>() {}

// =============================================================================
// Configuration
// =============================================================================

export interface AutomergeFsConfig {
  dataDir: string
}
