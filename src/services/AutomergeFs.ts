/**
 * AutomergeFs service for Effect.ts
 *
 * Provides file system operations backed by Automerge CRDTs
 * with typed errors and proper resource management.
 *
 * Uses one Automerge document per text file with updateText() for
 * character-level CRDT merging. Binary files are stored in a blob store.
 * Directory tree structure is maintained in a single root document.
 */

import { Context, Effect, Layer } from "effect"
import * as Automerge from "@automerge/automerge"
import { Repo, type DocHandle, type AutomergeUrl } from "@automerge/automerge-repo"
import { join } from "node:path"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
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
import { BlobStoreTag } from "./BlobStore"
import { StorageAdapter } from "./StorageAdapter"
import { DaemonConfig } from "../daemon/DaemonConfig"

// =============================================================================
// Document Schema
// =============================================================================

interface FsRootDoc {
  tree: Record<string, TreeEntry>
}

interface TreeEntry {
  type: "file" | "directory"
  parent: string | null
  name: string
  metadata: {
    size: number
    mode: number
    mtime: number
    ctime: number
  }
  fileDocId?: string // AutomergeUrl pointer to per-file Automerge doc (text files)
  blobHash?: string // pointer to blob store (binary files)
}

interface FileDoc {
  content: string // native CRDT string in Automerge 3.x
}

// =============================================================================
// AutomergeFsMultiDoc Implementation
// =============================================================================

export class AutomergeFsMultiDoc {
  private handle: DocHandle<FsRootDoc>
  private repo: Repo
  private blobStore: BlobStore
  private fileHandles: Map<string, DocHandle<FileDoc>> = new Map()

  private constructor(handle: DocHandle<FsRootDoc>, repo: Repo, blobStore: BlobStore) {
    this.handle = handle
    this.repo = repo
    this.blobStore = blobStore
  }

  static async create(opts: { repo: Repo; blobStore: BlobStore }): Promise<AutomergeFsMultiDoc> {
    const handle = opts.repo.create<FsRootDoc>()
    handle.change((doc) => {
      doc.tree = {}
      doc.tree["/"] = {
        type: "directory",
        parent: null,
        name: "/",
        metadata: {
          size: 0,
          mode: 0o755,
          mtime: Date.now(),
          ctime: Date.now(),
        },
      }
    })
    return new AutomergeFsMultiDoc(handle, opts.repo, opts.blobStore)
  }

  static async load(opts: {
    repo: Repo
    blobStore: BlobStore
    rootDocUrl: string
  }): Promise<AutomergeFsMultiDoc> {
    const handle = await opts.repo.find<FsRootDoc>(opts.rootDocUrl as AutomergeUrl)
    await handle.whenReady()
    return new AutomergeFsMultiDoc(handle, opts.repo, opts.blobStore)
  }

  get rootDocUrl(): string {
    return this.handle.url
  }

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  private normalizePath(path: string): string {
    if (path === "/") return "/"
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

  private getEntry(path: string): TreeEntry | null {
    const normalized = this.normalizePath(path)
    const doc = this.handle.doc()
    return doc?.tree?.[normalized] ?? null
  }

  private setEntry(path: string, entry: TreeEntry): void {
    const normalized = this.normalizePath(path)
    this.handle.change((doc) => {
      if (!doc.tree) {
        doc.tree = {}
      }
      doc.tree[normalized] = entry
    })
  }

  private deleteEntry(path: string): void {
    const normalized = this.normalizePath(path)
    this.handle.change((doc) => {
      if (doc.tree) {
        delete doc.tree[normalized]
      }
    })
  }

  // ===========================================================================
  // Binary Detection
  // ===========================================================================

  private isBinary(bytes: Uint8Array): boolean {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      return false
    } catch {
      return true
    }
  }

  // ===========================================================================
  // File Handle Management
  // ===========================================================================

  private async getOrLoadFileHandle(docId: string): Promise<DocHandle<FileDoc>> {
    let handle = this.fileHandles.get(docId)
    if (handle) return handle
    handle = await this.repo.find<FileDoc>(docId as AutomergeUrl)
    await handle.whenReady()
    this.fileHandles.set(docId, handle)
    return handle
  }

  private createFileDoc(initialContent: string): DocHandle<FileDoc> {
    const handle = this.repo.create<FileDoc>()
    handle.change((doc) => {
      doc.content = initialContent
    })
    this.fileHandles.set(handle.url, handle)
    return handle
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

    // Binary file in blob store
    if (entry.blobHash) {
      const blob = await this.blobStore.get(entry.blobHash)
      if (!blob) {
        throw new Error(`Blob not found: ${entry.blobHash}`)
      }
      return blob
    }

    // Text file in per-file Automerge doc
    if (entry.fileDocId) {
      const handle = await this.getOrLoadFileHandle(entry.fileDocId)
      const doc = handle.doc()
      return new TextEncoder().encode(doc?.content ?? "")
    }

    return new Uint8Array(0)
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const normalized = this.normalizePath(path)
    const parentPath = this.getParentPath(normalized)

    // Ensure parent directory exists
    const parent = this.getEntry(parentPath)
    if (!parent || parent.type !== "directory") {
      throw new Error(`ENOENT: no such file or directory: ${parentPath}`)
    }

    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content
    const size = bytes.length
    const binary = typeof content !== "string" && this.isBinary(bytes)

    const now = Date.now()
    const existing = this.getEntry(normalized)

    if (binary) {
      // Binary file → blob store
      const blobHash = this.createBlobHash(bytes)
      await this.blobStore.set(blobHash, bytes)

      // Clean up old file doc if switching from text to binary
      if (existing?.fileDocId) {
        this.fileHandles.delete(existing.fileDocId)
      }

      this.setEntry(normalized, {
        type: "file",
        parent: parentPath,
        name: this.getBasename(normalized),
        metadata: {
          size,
          mode: existing?.metadata.mode ?? 0o644,
          mtime: now,
          ctime: existing?.metadata.ctime ?? now,
        },
        blobHash,
      })
    } else {
      // Text file → per-file Automerge doc with updateText
      const text =
        typeof content === "string" ? content : new TextDecoder().decode(bytes)

      let fileDocId: string

      if (existing?.fileDocId) {
        // Update existing file doc using updateText for CRDT character-level diffing
        const handle = await this.getOrLoadFileHandle(existing.fileDocId)
        handle.change((doc) => {
          Automerge.updateText(doc, ["content"], text)
        })
        fileDocId = existing.fileDocId
      } else {
        // Create new file doc with initial content
        const handle = this.createFileDoc(text)
        fileDocId = handle.url
      }

      // Clean up old blob if switching from binary to text
      if (existing?.blobHash) {
        await this.blobStore.delete(existing.blobHash)
      }

      this.setEntry(normalized, {
        type: "file",
        parent: parentPath,
        name: this.getBasename(normalized),
        metadata: {
          size,
          mode: existing?.metadata.mode ?? 0o644,
          mtime: now,
          ctime: existing?.metadata.ctime ?? now,
        },
        fileDocId,
      })
    }
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

    // Append and write back using writeFile (which uses updateText for CRDT diff)
    const existingText = new TextDecoder().decode(existing)
    await this.writeFile(normalized, existingText + content)
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

  async readdir(
    path: string
  ): Promise<
    Array<{
      name: string
      isFile: boolean
      isDirectory: boolean
      isSymbolicLink: boolean
    }>
  > {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }
    if (entry.type !== "directory") {
      throw new Error(`ENOTDIR: not a directory: ${path}`)
    }

    const doc = this.handle.doc()
    const entries: Array<{
      name: string
      isFile: boolean
      isDirectory: boolean
      isSymbolicLink: boolean
    }> = []

    for (const [, entryData] of Object.entries(doc?.tree ?? {})) {
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
      parent: parentPath,
      name: this.getBasename(normalized),
      metadata: {
        size: 0,
        mode: 0o755,
        mtime: now,
        ctime: now,
      },
    })
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

    // Clean up file doc handle cache
    if (entry.type === "file" && entry.fileDocId) {
      this.fileHandles.delete(entry.fileDocId)
    }

    this.deleteEntry(normalized)
  }

  async exists(path: string): Promise<boolean> {
    return this.getEntry(path) !== null
  }

  // ===========================================================================
  // Version Control
  // ===========================================================================

  getRootHeads(): string[] {
    const doc = this.handle.doc()
    if (!doc) return []
    return [...Automerge.getHeads(doc)]
  }

  async getFileHeads(path: string): Promise<string[]> {
    const entry = this.getEntry(path)
    if (!entry?.fileDocId) return []
    const handle = await this.getOrLoadFileHandle(entry.fileDocId)
    const doc = handle.doc()
    if (!doc) return []
    return [...Automerge.getHeads(doc)]
  }

  async getFileHistory(
    path: string
  ): Promise<
    Array<{
      hash: string
      actor: string
      seq: number
      timestamp: number
      message: string | null
    }>
  > {
    const entry = this.getEntry(path)
    if (!entry?.fileDocId) return []
    const handle = await this.getOrLoadFileHandle(entry.fileDocId)
    const doc = handle.doc()
    if (!doc) return []
    const history = Automerge.getHistory(doc)
    return history.map((state) => ({
      hash: state.change.hash,
      actor: state.change.actor,
      seq: state.change.seq,
      timestamp: state.change.time,
      message: state.change.message ?? null,
    }))
  }

  async getFileAt(path: string, heads: string[]): Promise<string> {
    const entry = this.getEntry(path)
    if (!entry?.fileDocId) return ""
    const handle = await this.getOrLoadFileHandle(entry.fileDocId)
    const doc = handle.doc()
    if (!doc) return ""
    try {
      const viewed = Automerge.view(doc, heads as Automerge.Heads)
      return (viewed as unknown as FileDoc).content ?? ""
    } catch {
      return ""
    }
  }

  async diff(
    path: string,
    fromHeads: string[],
    toHeads: string[]
  ): Promise<Automerge.Patch[]> {
    const entry = this.getEntry(path)
    if (!entry?.fileDocId) return []
    const handle = await this.getOrLoadFileHandle(entry.fileDocId)
    const doc = handle.doc()
    if (!doc) return []
    try {
      return Automerge.diff(
        doc,
        fromHeads as Automerge.Heads,
        toHeads as Automerge.Heads
      )
    } catch {
      return []
    }
  }

  get rootDoc() {
    return {
      doc: async () => {
        const doc = this.handle.doc()
        if (!doc) return null
        // Return Automerge history of root doc as operationLog for compatibility
        const history = Automerge.getHistory(doc)
        return {
          operationLog: history.map((state) => ({
            hash: state.change.hash,
            actor: state.change.actor,
            seq: state.change.seq,
            timestamp: state.change.time,
            message: state.change.message ?? null,
          })),
        }
      },
    }
  }

  // ===========================================================================
  // Metadata
  // ===========================================================================

  async getAllDocumentIds(): Promise<string[]> {
    const ids: string[] = [this.handle.url]
    const doc = this.handle.doc()
    if (doc?.tree) {
      for (const entry of Object.values(doc.tree)) {
        if (entry.fileDocId) {
          ids.push(entry.fileDocId)
        }
      }
    }
    return ids
  }

  async getAllBlobHashes(): Promise<string[]> {
    return await this.blobStore.list()
  }

  // ===========================================================================
  // IFileSystem Methods (for just-bash compatibility)
  // ===========================================================================

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.readFile(path)
  }

  async readdirWithFileTypes(
    path: string
  ): Promise<
    Array<{
      name: string
      isFile(): boolean
      isDirectory(): boolean
      isSymbolicLink(): boolean
    }>
  > {
    const entries = await this.readdir(path)
    return entries.map((e) => ({
      name: e.name,
      isFile: () => e.isFile,
      isDirectory: () => e.isDirectory,
      isSymbolicLink: () => e.isSymbolicLink,
    }))
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)

    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    if (entry.type === "directory" && opts?.recursive) {
      // Delete all children recursively
      const children = await this.readdir(normalized)
      for (const child of children) {
        const childPath =
          normalized === "/" ? `/${child.name}` : `${normalized}/${child.name}`
        await this.rm(childPath, opts)
      }
    }

    if (entry.type === "file" && entry.blobHash) {
      await this.blobStore.delete(entry.blobHash)
    }
    if (entry.type === "file" && entry.fileDocId) {
      this.fileHandles.delete(entry.fileDocId)
    }

    this.deleteEntry(normalized)
  }

  async cp(
    src: string,
    dest: string,
    opts?: { recursive?: boolean }
  ): Promise<void> {
    const srcEntry = this.getEntry(src)
    if (!srcEntry) {
      throw new Error(`ENOENT: no such file or directory: ${src}`)
    }

    if (srcEntry.type === "file") {
      const content = await this.readFile(src)
      await this.writeFile(dest, content)
    } else if (srcEntry.type === "directory" && opts?.recursive) {
      await this.mkdir(dest, { recursive: true })
      const children = await this.readdir(src)
      const srcNorm = this.normalizePath(src)
      const destNorm = this.normalizePath(dest)
      for (const child of children) {
        const childSrc =
          srcNorm === "/" ? `/${child.name}` : `${srcNorm}/${child.name}`
        const childDest =
          destNorm === "/" ? `/${child.name}` : `${destNorm}/${child.name}`
        await this.cp(childSrc, childDest, opts)
      }
    } else if (srcEntry.type === "directory") {
      throw new Error(`EISDIR: is a directory: ${src}`)
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const srcEntry = this.getEntry(src)
    if (!srcEntry) {
      throw new Error(`ENOENT: no such file or directory: ${src}`)
    }

    if (srcEntry.type === "file") {
      // Move file: preserve fileDocId/blobHash, just update tree entry
      const destNorm = this.normalizePath(dest)
      const parentPath = this.getParentPath(destNorm)
      const parent = this.getEntry(parentPath)
      if (!parent || parent.type !== "directory") {
        throw new Error(`ENOENT: no such file or directory: ${parentPath}`)
      }

      const now = Date.now()
      const newEntry: TreeEntry = {
        type: srcEntry.type,
        parent: parentPath,
        name: this.getBasename(destNorm),
        metadata: {
          size: srcEntry.metadata.size,
          mode: srcEntry.metadata.mode,
          mtime: now,
          ctime: srcEntry.metadata.ctime,
        },
      }
      if (srcEntry.fileDocId) newEntry.fileDocId = srcEntry.fileDocId
      if (srcEntry.blobHash) newEntry.blobHash = srcEntry.blobHash

      this.setEntry(destNorm, newEntry)
      this.deleteEntry(src)
    } else {
      throw new Error("Moving directories is not currently supported")
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    this.handle.change((doc) => {
      if (doc.tree[normalized]) {
        doc.tree[normalized].metadata.mode = mode
      }
    })
  }

  async lstat(path: string): Promise<{
    size: number
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
    mode: number
    mtime: Date
    ctime: Date
  }> {
    return this.stat(path) // No real symlinks
  }

  async symlink(): Promise<void> {
    throw new Error("Symbolic links are not supported in AutomergeFs")
  }

  async link(): Promise<void> {
    throw new Error("Hard links are not supported in AutomergeFs")
  }

  async readlink(): Promise<string> {
    throw new Error("Symbolic links are not supported in AutomergeFs")
  }

  async realpath(path: string): Promise<string> {
    return this.normalizePath(path)
  }

  resolvePath(base: string, ...paths: string[]): string {
    let result = base
    for (const p of paths) {
      if (p.startsWith("/")) {
        result = p
      } else {
        result = result === "/" ? `/${p}` : `${result}/${p}`
      }
    }
    return this.normalizePath(result)
  }

  getAllPaths(): string[] {
    const doc = this.handle.doc()
    if (!doc?.tree) return []
    return Object.keys(doc.tree)
  }

  async utimes(path: string, _atime: number, mtime: number): Promise<void> {
    const normalized = this.normalizePath(path)
    const entry = this.getEntry(normalized)
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory: ${path}`)
    }

    this.handle.change((doc) => {
      if (doc.tree[normalized]) {
        doc.tree[normalized].metadata.mtime = mtime
      }
    })
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private createBlobHash(data: Uint8Array): string {
    const hasher = new Bun.CryptoHasher("sha256")
    hasher.update(data)
    return hasher.digest("hex")
  }
}

// =============================================================================
// Effect Service Interface
// =============================================================================

export interface AutomergeFsService {
  readonly readFile: (
    path: string
  ) => Effect.Effect<Uint8Array, FileReadError | FileNotFoundError>

  readonly writeFile: (
    path: string,
    content: string | Uint8Array
  ) => Effect.Effect<void, FileWriteError>

  readonly appendFile: (
    path: string,
    content: string
  ) => Effect.Effect<void, FileWriteError>

  readonly stat: (
    path: string
  ) => Effect.Effect<FileStat, FileStatError | FileNotFoundError>

  readonly readdir: (
    path: string
  ) => Effect.Effect<DirEntry[], DirectoryReadError>

  readonly mkdir: (
    path: string,
    options?: { recursive?: boolean }
  ) => Effect.Effect<void, DirectoryCreateError>

  readonly unlink: (
    path: string
  ) => Effect.Effect<void, FileDeleteError | FileNotFoundError>

  readonly exists: (path: string) => Effect.Effect<boolean>

  readonly rename: (
    oldPath: string,
    newPath: string
  ) => Effect.Effect<
    void,
    FileReadError | FileWriteError | FileDeleteError | FileNotFoundError
  >

  readonly copy: (
    src: string,
    dest: string
  ) => Effect.Effect<
    void,
    FileReadError | FileWriteError | FileNotFoundError
  >

  // Version control
  readonly getRootHeads: () => Effect.Effect<string[]>
  readonly getFileHeads: (path: string) => Effect.Effect<string[]>
  readonly getFileHistory: (path: string) => Effect.Effect<unknown[]>
  readonly getFileAt: (path: string, heads: string[]) => Effect.Effect<string>
  readonly diff: (
    path: string,
    fromHeads: string[],
    toHeads: string[]
  ) => Effect.Effect<unknown[]>
  readonly getRootDoc: () => Effect.Effect<{ operationLog?: unknown[] } | null>

  // Metadata
  readonly getAllDocumentIds: () => Effect.Effect<string[]>
  readonly getAllBlobHashes: () => Effect.Effect<string[]>
}

export class AutomergeFs extends Context.Tag("AutomergeFs")<
  AutomergeFs,
  AutomergeFsService
>() {}

export class AutomergeFsInstance extends Context.Tag("AutomergeFsInstance")<
  AutomergeFsInstance,
  AutomergeFsMultiDoc
>() {}

// =============================================================================
// Live Layer
// =============================================================================

/**
 * AutomergeFsLive — reads DaemonConfig + StorageAdapter + BlobStoreTag,
 * creates Repo, loads/creates AutomergeFsMultiDoc, provides both
 * AutomergeFs (wrapped service) and AutomergeFsInstance (raw class)
 */
export const AutomergeFsLive = Layer.effectContext(
  Effect.gen(function* () {
    const config = yield* DaemonConfig
    const storage = yield* StorageAdapter
    const blobStore = yield* BlobStoreTag

    const repo = new Repo({ storage })

    const rootDocIdFile = join(config.dataDir, "root-doc-id")
    let fs: AutomergeFsMultiDoc

    if (existsSync(rootDocIdFile)) {
      const rootDocUrl = readFileSync(rootDocIdFile, "utf-8").trim()
      console.log(`Loading existing filesystem: ${rootDocUrl}`)
      fs = yield* Effect.promise(() =>
        AutomergeFsMultiDoc.load({ repo, blobStore, rootDocUrl })
      )
    } else {
      console.log("Creating new filesystem...")
      fs = yield* Effect.promise(() =>
        AutomergeFsMultiDoc.create({ repo, blobStore })
      )
      writeFileSync(rootDocIdFile, fs.rootDocUrl, "utf-8")
    }

    const fsService = wrapAutomergeFsInstance(fs)

    return Context.empty().pipe(
      Context.add(AutomergeFs, fsService),
      Context.add(AutomergeFsInstance, fs),
    )
  })
)

// =============================================================================
// Service Factory
// =============================================================================

/**
 * Wraps an AutomergeFsMultiDoc instance into an AutomergeFsService.
 */
export function wrapAutomergeFsInstance(fs: AutomergeFsMultiDoc): AutomergeFsService {
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
      Effect.tryPromise({
        try: () => fs.mv(oldPath, newPath),
        catch: (e) => {
          const err = e as Error
          if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
            return new FileNotFoundError({ path: oldPath })
          }
          return new FileWriteError({ path: newPath, cause: e })
        },
      }),

    copy: (src: string, dest: string) =>
      Effect.tryPromise({
        try: () => fs.cp(src, dest),
        catch: (e) => {
          const err = e as Error
          if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
            return new FileNotFoundError({ path: src })
          }
          return new FileWriteError({ path: dest, cause: e })
        },
      }),

    getRootHeads: () =>
      Effect.sync(() => fs.getRootHeads()),

    getFileHeads: (path: string) =>
      Effect.tryPromise({
        try: () => fs.getFileHeads(path),
        catch: () => [] as string[],
      }).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),

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

    diff: (path: string, fromHeads: string[], toHeads: string[]) =>
      Effect.tryPromise({
        try: () => fs.diff(path, fromHeads, toHeads) as Promise<unknown[]>,
        catch: () => [] as unknown[],
      }).pipe(Effect.catchAll(() => Effect.succeed([] as unknown[]))),

    getRootDoc: () =>
      Effect.tryPromise({
        try: async () => {
          const doc = await fs.rootDoc.doc()
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
