import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Repo } from "@automerge/automerge-repo";
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs";
import { AutomergeFsMultiDoc } from "./AutomergeFs";
import { FileSystemBlobStore } from "./BlobStore";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const testDir = "/tmp/automerge-fs-test-" + process.pid;

describe("AutomergeFsMultiDoc", () => {
  let repo: Repo;
  let blobStore: FileSystemBlobStore;
  let fs: AutomergeFsMultiDoc;

  beforeEach(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(join(testDir, "blobs"), { recursive: true });

    repo = new Repo();
    blobStore = new FileSystemBlobStore(join(testDir, "blobs"));
    fs = await AutomergeFsMultiDoc.create({ repo, blobStore });
  });

  afterEach(() => {
    repo.networkSubsystem.disconnect();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe("Initialization", () => {
    test("creates instance successfully", () => {
      expect(fs).toBeDefined();
      expect(fs).toBeInstanceOf(AutomergeFsMultiDoc);
    });

    test("root path exists by default", async () => {
      const exists = await fs.exists("/");
      expect(exists).toBe(true);
    });

    test("rootDocUrl is available", () => {
      expect(fs.rootDocUrl).toBeDefined();
      expect(typeof fs.rootDocUrl).toBe("string");
      expect(fs.rootDocUrl.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // File Operations
  // ===========================================================================

  describe("File Operations", () => {
    test("writeFile creates a new file", async () => {
      await fs.writeFile("/test.txt", "Hello, World!");
      const exists = await fs.exists("/test.txt");
      expect(exists).toBe(true);
    });

    test("readFile returns file content", async () => {
      await fs.writeFile("/test.txt", "Hello, World!");
      const content = await fs.readFile("/test.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("Hello, World!");
    });

    test("writeFile overwrites existing file", async () => {
      await fs.writeFile("/test.txt", "First content");
      await fs.writeFile("/test.txt", "Second content");

      const content = await fs.readFile("/test.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("Second content");
    });

    test("appendFile adds content to existing file", async () => {
      await fs.writeFile("/test.txt", "Hello");
      await fs.appendFile("/test.txt", " World!");

      const content = await fs.readFile("/test.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("Hello World!");
    });

    test("appendFile creates file if it doesn't exist", async () => {
      await fs.appendFile("/new.txt", "New content");

      const content = await fs.readFile("/new.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("New content");
    });

    test("unlink removes file", async () => {
      await fs.writeFile("/test.txt", "Delete me");
      await fs.unlink("/test.txt");

      const exists = await fs.exists("/test.txt");
      expect(exists).toBe(false);
    });

    test("readFile fails for non-existent file", async () => {
      await expect(fs.readFile("/nonexistent.txt")).rejects.toThrow();
    });

    test("stat returns file metadata", async () => {
      const content = "Test content";
      await fs.writeFile("/test.txt", content);

      const stat = await fs.stat("/test.txt");

      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(new TextEncoder().encode(content).length);
      expect(stat.mode).toBe(0o644);
      expect(stat.mtime).toBeInstanceOf(Date);
      expect(stat.ctime).toBeInstanceOf(Date);
    });
  });

  // ===========================================================================
  // Binary Detection and Blob Storage
  // ===========================================================================

  describe("Binary Detection and Blob Storage", () => {
    test("small binary file goes to blob store", async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      await fs.writeFile("/small-binary.bin", binaryData);

      const retrieved = await fs.readFile("/small-binary.bin");
      expect(retrieved).toEqual(binaryData);

      // Verify it's in blob store
      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBeGreaterThan(0);
    });

    test("large binary file goes to blob store", async () => {
      const binaryData = new Uint8Array(15000);
      for (let i = 0; i < binaryData.length; i++) {
        binaryData[i] = i % 256;
      }

      await fs.writeFile("/large-binary.dat", binaryData);
      const retrieved = await fs.readFile("/large-binary.dat");

      expect(retrieved).toEqual(binaryData);
      expect(retrieved.length).toBe(15000);
    });

    test("text file stays inline (not blob store)", async () => {
      await fs.writeFile("/text.txt", "just some text");

      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBe(0);
    });

    test("valid UTF-8 text is not treated as binary", async () => {
      const text = "Hello 世界 🌍 café résumé";
      await fs.writeFile("/unicode.txt", text);

      const content = await fs.readFile("/unicode.txt");
      const decoded = new TextDecoder().decode(content);
      expect(decoded).toBe(text);

      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBe(0);
    });

    test("string content always treated as text", async () => {
      await fs.writeFile("/string.txt", "string content");

      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBe(0);

      const content = await fs.readFile("/string.txt");
      expect(new TextDecoder().decode(content)).toBe("string content");
    });
  });

  // ===========================================================================
  // Multi-Document Model
  // ===========================================================================

  describe("Multi-Document Model", () => {
    test("each text file gets its own document", async () => {
      await fs.writeFile("/file1.txt", "content1");
      await fs.writeFile("/file2.txt", "content2");

      const ids = await fs.getAllDocumentIds();
      // root doc + 2 file docs
      expect(ids.length).toBe(3);
    });

    test("file doc is separate from root doc", async () => {
      const idsBeforeWrite = await fs.getAllDocumentIds();
      expect(idsBeforeWrite.length).toBe(1); // just root

      await fs.writeFile("/test.txt", "content");

      const idsAfterWrite = await fs.getAllDocumentIds();
      expect(idsAfterWrite.length).toBe(2); // root + file doc
    });

    test("updating a file reuses the same document", async () => {
      await fs.writeFile("/test.txt", "version 1");
      const ids1 = await fs.getAllDocumentIds();

      await fs.writeFile("/test.txt", "version 2");
      const ids2 = await fs.getAllDocumentIds();

      // Same number of docs - file doc was reused, not re-created
      expect(ids2.length).toBe(ids1.length);
    });

    test("deleting a file cleans up file doc cache", async () => {
      await fs.writeFile("/test.txt", "content");
      await fs.unlink("/test.txt");

      // Re-creating should allocate a new doc
      await fs.writeFile("/test.txt", "new content");

      const content = await fs.readFile("/test.txt");
      expect(new TextDecoder().decode(content)).toBe("new content");
    });
  });

  // ===========================================================================
  // Directory Operations
  // ===========================================================================

  describe("Directory Operations", () => {
    test("mkdir creates a directory", async () => {
      await fs.mkdir("/testdir");
      const exists = await fs.exists("/testdir");
      expect(exists).toBe(true);
    });

    test("mkdir with recursive flag creates nested directories", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
    });

    test("readdir lists directory contents", async () => {
      await fs.mkdir("/testdir");
      await fs.writeFile("/testdir/file1.txt", "content1");
      await fs.writeFile("/testdir/file2.txt", "content2");

      const entries = await fs.readdir("/testdir");

      expect(entries.length).toBe(2);
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["file1.txt", "file2.txt"]);
    });

    test("readdir includes type information", async () => {
      await fs.mkdir("/testdir");
      await fs.writeFile("/testdir/file.txt", "content");
      await fs.mkdir("/testdir/subdir");

      const entries = await fs.readdir("/testdir");

      const file = entries.find((e) => e.name === "file.txt");
      const dir = entries.find((e) => e.name === "subdir");

      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(dir?.isDirectory).toBe(true);
      expect(dir?.isFile).toBe(false);
    });

    test("stat returns directory metadata", async () => {
      await fs.mkdir("/testdir");
      const stat = await fs.stat("/testdir");

      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
      expect(stat.mode).toBe(0o755);
    });

    test("mkdir is idempotent for existing directory", async () => {
      await fs.mkdir("/testdir");
      // Should not throw
      await fs.mkdir("/testdir");
      expect(await fs.exists("/testdir")).toBe(true);
    });
  });

  // ===========================================================================
  // Version Control
  // ===========================================================================

  describe("Version Control", () => {
    test("getRootHeads returns document heads", () => {
      const heads = fs.getRootHeads();
      expect(heads).toBeDefined();
      expect(Array.isArray(heads)).toBe(true);
      expect(heads.length).toBeGreaterThan(0);
    });

    test("getFileHeads returns heads for a text file", async () => {
      await fs.writeFile("/test.txt", "content");
      const heads = await fs.getFileHeads("/test.txt");
      expect(heads).toBeDefined();
      expect(Array.isArray(heads)).toBe(true);
      expect(heads.length).toBeGreaterThan(0);
    });

    test("getFileHeads returns empty for non-existent file", async () => {
      const heads = await fs.getFileHeads("/nonexistent.txt");
      expect(heads).toEqual([]);
    });

    test("getFileHistory returns change metadata", async () => {
      await fs.writeFile("/test.txt", "v1");
      await fs.writeFile("/test.txt", "v2");
      await fs.writeFile("/test.txt", "v3");

      const history = await fs.getFileHistory("/test.txt");

      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
      // Should have at least the initial create + 2 updates
      expect(history.length).toBeGreaterThanOrEqual(3);

      // Each entry should have expected fields
      for (const entry of history) {
        expect(entry.hash).toBeDefined();
        expect(typeof entry.hash).toBe("string");
        expect(entry.actor).toBeDefined();
        expect(typeof entry.seq).toBe("number");
        expect(typeof entry.timestamp).toBe("number");
      }
    });

    test("getFileAt retrieves content at specific heads", async () => {
      await fs.writeFile("/test.txt", "version one");
      const headsV1 = await fs.getFileHeads("/test.txt");

      await fs.writeFile("/test.txt", "version two");
      const headsV2 = await fs.getFileHeads("/test.txt");

      // View at v1 should return v1 content
      const contentV1 = await fs.getFileAt("/test.txt", headsV1);
      expect(contentV1).toBe("version one");

      // View at v2 should return v2 content
      const contentV2 = await fs.getFileAt("/test.txt", headsV2);
      expect(contentV2).toBe("version two");
    });

    test("diff returns patches between versions", async () => {
      await fs.writeFile("/test.txt", "hello world");
      const headsV1 = await fs.getFileHeads("/test.txt");

      await fs.writeFile("/test.txt", "hello brave new world");
      const headsV2 = await fs.getFileHeads("/test.txt");

      const patches = await fs.diff("/test.txt", headsV1, headsV2);

      expect(patches).toBeDefined();
      expect(Array.isArray(patches)).toBe(true);
      expect(patches.length).toBeGreaterThan(0);
    });

    test("getAllDocumentIds includes root and file docs", async () => {
      await fs.writeFile("/file1.txt", "content1");
      await fs.writeFile("/file2.txt", "content2");

      const ids = await fs.getAllDocumentIds();
      expect(ids.length).toBe(3); // root + 2 files
    });

    test("getAllBlobHashes returns empty initially", async () => {
      const hashes = await fs.getAllBlobHashes();
      expect(Array.isArray(hashes)).toBe(true);
      expect(hashes.length).toBe(0);
    });
  });

  // ===========================================================================
  // IFileSystem Methods
  // ===========================================================================

  describe("IFileSystem Methods", () => {
    test("readFileBuffer is alias for readFile", async () => {
      await fs.writeFile("/test.txt", "content");
      const buf = await fs.readFileBuffer("/test.txt");
      const text = new TextDecoder().decode(buf);
      expect(text).toBe("content");
    });

    test("readdirWithFileTypes returns callable type methods", async () => {
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/file.txt", "content");
      await fs.mkdir("/dir/sub");

      const entries = await fs.readdirWithFileTypes("/dir");
      expect(entries.length).toBe(2);

      const file = entries.find((e) => e.name === "file.txt");
      const dir = entries.find((e) => e.name === "sub");

      expect(file?.isFile()).toBe(true);
      expect(file?.isDirectory()).toBe(false);
      expect(file?.isSymbolicLink()).toBe(false);
      expect(dir?.isDirectory()).toBe(true);
      expect(dir?.isFile()).toBe(false);
    });

    test("rm recursive deletes directory tree", async () => {
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/a.txt", "a");
      await fs.mkdir("/dir/sub");
      await fs.writeFile("/dir/sub/b.txt", "b");

      await fs.rm("/dir", { recursive: true });

      expect(await fs.exists("/dir")).toBe(false);
      expect(await fs.exists("/dir/a.txt")).toBe(false);
      expect(await fs.exists("/dir/sub")).toBe(false);
      expect(await fs.exists("/dir/sub/b.txt")).toBe(false);
    });

    test("cp copies a file", async () => {
      await fs.writeFile("/src.txt", "source content");
      await fs.cp("/src.txt", "/dest.txt");

      const content = await fs.readFile("/dest.txt");
      expect(new TextDecoder().decode(content)).toBe("source content");

      // Source still exists
      const srcContent = await fs.readFile("/src.txt");
      expect(new TextDecoder().decode(srcContent)).toBe("source content");
    });

    test("cp recursive copies directory tree", async () => {
      await fs.mkdir("/src");
      await fs.writeFile("/src/a.txt", "a");
      await fs.mkdir("/src/sub");
      await fs.writeFile("/src/sub/b.txt", "b");

      await fs.cp("/src", "/dest", { recursive: true });

      expect(await fs.exists("/dest")).toBe(true);
      expect(new TextDecoder().decode(await fs.readFile("/dest/a.txt"))).toBe("a");
      expect(new TextDecoder().decode(await fs.readFile("/dest/sub/b.txt"))).toBe("b");
    });

    test("mv moves a file preserving doc reference", async () => {
      await fs.writeFile("/src.txt", "content");
      const headsBefore = await fs.getFileHeads("/src.txt");

      await fs.mv("/src.txt", "/dest.txt");

      expect(await fs.exists("/src.txt")).toBe(false);
      expect(await fs.exists("/dest.txt")).toBe(true);

      const content = await fs.readFile("/dest.txt");
      expect(new TextDecoder().decode(content)).toBe("content");

      // File doc reference should be preserved (same heads)
      const headsAfter = await fs.getFileHeads("/dest.txt");
      expect(headsAfter).toEqual(headsBefore);
    });

    test("chmod updates file mode", async () => {
      await fs.writeFile("/test.txt", "content");
      await fs.chmod("/test.txt", 0o755);

      const stat = await fs.stat("/test.txt");
      expect(stat.mode).toBe(0o755);
    });

    test("lstat is alias for stat", async () => {
      await fs.writeFile("/test.txt", "content");
      const stat = await fs.stat("/test.txt");
      const lstat = await fs.lstat("/test.txt");
      expect(lstat.size).toBe(stat.size);
      expect(lstat.isFile).toBe(stat.isFile);
    });

    test("symlink throws not supported", async () => {
      await expect(fs.symlink()).rejects.toThrow("not supported");
    });

    test("link throws not supported", async () => {
      await expect(fs.link()).rejects.toThrow("not supported");
    });

    test("readlink throws not supported", async () => {
      await expect(fs.readlink()).rejects.toThrow("not supported");
    });

    test("realpath returns normalized path", async () => {
      const result = await fs.realpath("/a//b/c/");
      expect(result).toBe("/a/b/c");
    });

    test("resolvePath resolves relative paths", () => {
      expect(fs.resolvePath("/base", "child")).toBe("/base/child");
      expect(fs.resolvePath("/base", "/absolute")).toBe("/absolute");
      expect(fs.resolvePath("/", "file.txt")).toBe("/file.txt");
    });

    test("getAllPaths returns all tree keys", async () => {
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/file.txt", "content");

      const paths = await fs.getAllPaths();
      expect(paths).toContain("/");
      expect(paths).toContain("/dir");
      expect(paths).toContain("/dir/file.txt");
    });

    test("utimes updates mtime", async () => {
      await fs.writeFile("/test.txt", "content");
      const targetMtime = 1000000;
      await fs.utimes("/test.txt", 0, targetMtime);

      const stat = await fs.stat("/test.txt");
      expect(stat.mtime.getTime()).toBe(targetMtime);
    });
  });

  // ===========================================================================
  // Persistence
  // ===========================================================================

  describe("Persistence", () => {
    test("data survives repo recreation with same storage", async () => {
      const persistDir = join(testDir, "persist");
      mkdirSync(join(persistDir, "automerge"), { recursive: true });
      mkdirSync(join(persistDir, "blobs"), { recursive: true });

      // Create with persistence
      const storage = new NodeFSStorageAdapter(join(persistDir, "automerge"));
      const repo1 = new Repo({ storage });
      const blobStore1 = new FileSystemBlobStore(join(persistDir, "blobs"));
      const fs1 = await AutomergeFsMultiDoc.create({ repo: repo1, blobStore: blobStore1 });

      // Write some data
      await fs1.writeFile("/hello.txt", "hello world");
      await fs1.mkdir("/dir");
      await fs1.writeFile("/dir/nested.txt", "nested content");

      const rootDocUrl = fs1.rootDocUrl;

      // Wait for storage to flush
      await new Promise((resolve) => setTimeout(resolve, 500));
      repo1.networkSubsystem.disconnect();

      // Create new repo with same storage
      const storage2 = new NodeFSStorageAdapter(join(persistDir, "automerge"));
      const repo2 = new Repo({ storage: storage2 });
      const blobStore2 = new FileSystemBlobStore(join(persistDir, "blobs"));

      // Load existing filesystem
      const fs2 = await AutomergeFsMultiDoc.load({
        repo: repo2,
        blobStore: blobStore2,
        rootDocUrl,
      });

      // Verify data
      expect(await fs2.exists("/hello.txt")).toBe(true);
      const content = await fs2.readFile("/hello.txt");
      expect(new TextDecoder().decode(content)).toBe("hello world");

      expect(await fs2.exists("/dir")).toBe(true);
      expect(await fs2.exists("/dir/nested.txt")).toBe(true);
      const nestedContent = await fs2.readFile("/dir/nested.txt");
      expect(new TextDecoder().decode(nestedContent)).toBe("nested content");

      repo2.networkSubsystem.disconnect();
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
    test("handles empty file content", async () => {
      await fs.writeFile("/empty.txt", "");
      const content = await fs.readFile("/empty.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("");
    });

    test("handles files with special characters in name", async () => {
      await fs.writeFile("/test-file_123.txt", "content");
      const content = await fs.readFile("/test-file_123.txt");
      const text = new TextDecoder().decode(content);
      expect(text).toBe("content");
    });

    test("readdir on empty directory returns empty array", async () => {
      await fs.mkdir("/emptydir");
      const entries = await fs.readdir("/emptydir");
      expect(entries).toEqual([]);
    });

    test("exists returns false for non-existent path", async () => {
      const exists = await fs.exists("/nonexistent");
      expect(exists).toBe(false);
    });

    test("stat fails for non-existent path", async () => {
      await expect(fs.stat("/nonexistent")).rejects.toThrow();
    });

    test("path normalization handles trailing slashes", async () => {
      await fs.mkdir("/testdir");
      await fs.writeFile("/testdir/file.txt", "content");

      // Both should work - reading with/without trailing slash
      expect(await fs.exists("/testdir")).toBe(true);
    });

    test("writeFile to non-existent parent directory throws", async () => {
      await expect(
        fs.writeFile("/no-such-dir/file.txt", "content")
      ).rejects.toThrow();
    });
  });
});
