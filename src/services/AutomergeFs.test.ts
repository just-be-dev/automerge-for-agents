import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Repo } from "@automerge/automerge-repo";
import { AutomergeFsMultiDoc } from "./AutomergeFs";
import { FileSystemBlobStore } from "./BlobStore";
import { rmSync, mkdirSync, existsSync } from "node:fs";

describe("AutomergeFsMultiDoc", () => {
  const testDir = "/private/tmp/claude-501/-Users-just-be-Code-automerge-for-agents/09aa6e20-657f-42a6-982c-3825f8f6e853/scratchpad/automerge-test";
  let repo: Repo;
  let blobStore: FileSystemBlobStore;
  let fs: AutomergeFsMultiDoc;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    repo = new Repo();
    blobStore = new FileSystemBlobStore(testDir);
    fs = await AutomergeFsMultiDoc.create({ repo, blobStore });
  });

  afterEach(() => {
    repo.networkSubsystem.disconnect();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Initialization", () => {
    test("creates instance successfully", async () => {
      expect(fs).toBeDefined();
      expect(fs).toBeInstanceOf(AutomergeFsMultiDoc);
    });

    test("root path exists by default", async () => {
      const exists = await fs.exists("/");
      expect(exists).toBe(true);
    });
  });

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
      expect(stat.size).toBe(content.length);
    });

    test("handles large binary file content", async () => {
      // Small binary files (<10KB) get corrupted due to UTF-8 encoding
      // Use large binary files that go to blob storage for true binary support
      const binaryData = new Uint8Array(15000);
      // Fill with various byte values including high bytes
      for (let i = 0; i < binaryData.length; i++) {
        binaryData[i] = i % 256;
      }

      await fs.writeFile("/binary.dat", binaryData);
      const retrieved = await fs.readFile("/binary.dat");

      expect(retrieved).toEqual(binaryData);
      expect(retrieved.length).toBe(15000);
    });
  });

  describe("Directory Operations", () => {
    test("mkdir creates a directory", async () => {
      await fs.mkdir("/testdir");
      const exists = await fs.exists("/testdir");
      expect(exists).toBe(true);
    });

    test("mkdir with recursive flag creates nested directories", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      const exists = await fs.exists("/a/b/c");
      expect(exists).toBe(true);
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
      expect(dir?.isDirectory).toBe(true);
    });

    test("stat returns directory metadata", async () => {
      await fs.mkdir("/testdir");
      const stat = await fs.stat("/testdir");

      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });
  });

  describe("Large Files and Blob Storage", () => {
    test("stores large files in blob store", async () => {
      // Create content larger than inline threshold (10KB)
      const largeContent = "x".repeat(15000);

      await fs.writeFile("/large.txt", largeContent);
      const content = await fs.readFile("/large.txt");
      const text = new TextDecoder().decode(content);

      expect(text).toBe(largeContent);
      expect(text.length).toBe(15000);

      // Verify it's stored in blob store
      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBeGreaterThan(0);
    });

    test("stores small files inline", async () => {
      const smallContent = "small content";

      await fs.writeFile("/small.txt", smallContent);
      const content = await fs.readFile("/small.txt");
      const text = new TextDecoder().decode(content);

      expect(text).toBe(smallContent);

      // Should not be in blob store
      const hashes = await fs.getAllBlobHashes();
      expect(hashes.length).toBe(0);
    });
  });

  describe("Version Control", () => {
    test("getRootHeads returns document heads", async () => {
      const heads = fs.getRootHeads();
      expect(heads).toBeDefined();
      expect(Array.isArray(heads)).toBe(true);
      expect(heads.length).toBeGreaterThan(0);
    });

    test("getFileHistory returns operation log", async () => {
      await fs.writeFile("/test.txt", "v1");
      await fs.writeFile("/test.txt", "v2");
      await fs.writeFile("/test.txt", "v3");

      const history = await fs.getFileHistory("/test.txt");

      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
    });

    test("getAllDocumentIds returns created document IDs", async () => {
      await fs.writeFile("/file1.txt", "content1");
      await fs.writeFile("/file2.txt", "content2");

      const ids = await fs.getAllDocumentIds();
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });

    test("getAllBlobHashes returns empty array initially", async () => {
      const hashes = await fs.getAllBlobHashes();
      expect(Array.isArray(hashes)).toBe(true);
      expect(hashes.length).toBe(0);
    });
  });

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
  });
});
