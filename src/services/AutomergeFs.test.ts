import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { Repo } from "@automerge/automerge-repo";
import { AutomergeFsMultiDoc } from "./AutomergeFs";
import { FileSystemBlobStore } from "./BlobStore";
import { rmSync, mkdirSync, existsSync } from "node:fs";

describe("AutomergeFsMultiDoc", () => {
  const testDir = "/private/tmp/claude-501/-Users-just-be-Code-automerge-for-agents/09aa6e20-657f-42a6-982c-3825f8f6e853/scratchpad/automerge-test";
  let repo: Repo;
  let blobStore: FileSystemBlobStore;
  let fs: AutomergeFsMultiDoc;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    repo = new Repo();
    blobStore = new FileSystemBlobStore(testDir);
    fs = new AutomergeFsMultiDoc(repo, blobStore);
  });

  afterEach(() => {
    repo.networkSubsystem.disconnect();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("File Operations", () => {
    test("writeFile creates a new file", async () => {
      const program = fs.writeFile("/test.txt", "Hello, World!");
      await Effect.runPromise(program);

      const exists = await Effect.runPromise(fs.exists("/test.txt"));
      expect(exists).toBe(true);
    });

    test("readFile returns file content", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "Hello, World!"));
      const content = await Effect.runPromise(fs.readFile("/test.txt"));

      expect(content).toBe("Hello, World!");
    });

    test("writeFile overwrites existing file", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "First content"));
      await Effect.runPromise(fs.writeFile("/test.txt", "Second content"));

      const content = await Effect.runPromise(fs.readFile("/test.txt"));
      expect(content).toBe("Second content");
    });

    test("appendFile adds content to existing file", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "Hello"));
      await Effect.runPromise(fs.appendFile("/test.txt", " World!"));

      const content = await Effect.runPromise(fs.readFile("/test.txt"));
      expect(content).toBe("Hello World!");
    });

    test("appendFile creates file if it doesn't exist", async () => {
      await Effect.runPromise(fs.appendFile("/new.txt", "New content"));

      const content = await Effect.runPromise(fs.readFile("/new.txt"));
      expect(content).toBe("New content");
    });

    test("unlink removes file", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "Delete me"));
      await Effect.runPromise(fs.unlink("/test.txt"));

      const exists = await Effect.runPromise(fs.exists("/test.txt"));
      expect(exists).toBe(false);
    });

    test("readFile fails for non-existent file", async () => {
      const program = fs.readFile("/nonexistent.txt");

      await expect(Effect.runPromise(program)).rejects.toThrow();
    });

    test("stat returns file metadata", async () => {
      const content = "Test content";
      await Effect.runPromise(fs.writeFile("/test.txt", content));

      const stat = await Effect.runPromise(fs.stat("/test.txt"));

      expect(stat.type).toBe("file");
      expect(stat.size).toBe(content.length);
      expect(stat.name).toBe("test.txt");
    });
  });

  describe("Directory Operations", () => {
    test("mkdir creates a directory", async () => {
      await Effect.runPromise(fs.mkdir("/testdir"));

      const exists = await Effect.runPromise(fs.exists("/testdir"));
      expect(exists).toBe(true);
    });

    test("mkdir with recursive flag creates nested directories", async () => {
      await Effect.runPromise(fs.mkdir("/a/b/c", { recursive: true }));

      const exists = await Effect.runPromise(fs.exists("/a/b/c"));
      expect(exists).toBe(true);
    });

    test("readdir lists directory contents", async () => {
      await Effect.runPromise(fs.mkdir("/testdir"));
      await Effect.runPromise(fs.writeFile("/testdir/file1.txt", "content1"));
      await Effect.runPromise(fs.writeFile("/testdir/file2.txt", "content2"));

      const entries = await Effect.runPromise(fs.readdir("/testdir"));

      expect(entries.length).toBe(2);
      expect(entries.map((e) => e.name).sort()).toEqual([
        "file1.txt",
        "file2.txt",
      ]);
    });

    test("readdir includes type information", async () => {
      await Effect.runPromise(fs.mkdir("/testdir"));
      await Effect.runPromise(fs.writeFile("/testdir/file.txt", "content"));
      await Effect.runPromise(fs.mkdir("/testdir/subdir"));

      const entries = await Effect.runPromise(fs.readdir("/testdir"));

      const file = entries.find((e) => e.name === "file.txt");
      const dir = entries.find((e) => e.name === "subdir");

      expect(file?.type).toBe("file");
      expect(dir?.type).toBe("directory");
    });

    test("stat returns directory metadata", async () => {
      await Effect.runPromise(fs.mkdir("/testdir"));

      const stat = await Effect.runPromise(fs.stat("/testdir"));

      expect(stat.type).toBe("directory");
      expect(stat.name).toBe("testdir");
    });
  });

  describe("Path Handling", () => {
    test("normalizes paths with trailing slashes", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "content"));

      const content = await Effect.runPromise(fs.readFile("/test.txt/"));
      expect(content).toBe("content");
    });

    test("handles nested paths", async () => {
      await Effect.runPromise(
        fs.mkdir("/a/b/c", { recursive: true })
      );
      await Effect.runPromise(fs.writeFile("/a/b/c/file.txt", "nested"));

      const content = await Effect.runPromise(fs.readFile("/a/b/c/file.txt"));
      expect(content).toBe("nested");
    });

    test("exists returns false for non-existent path", async () => {
      const exists = await Effect.runPromise(fs.exists("/nonexistent"));
      expect(exists).toBe(false);
    });
  });

  describe("Blob Storage", () => {
    test("stores large files in blob store", async () => {
      // Create content larger than inline threshold (10KB)
      const largeContent = "x".repeat(15000);

      await Effect.runPromise(fs.writeFile("/large.txt", largeContent));
      const retrieved = await Effect.runPromise(fs.readFile("/large.txt"));

      expect(retrieved).toBe(largeContent);
      expect(retrieved.length).toBe(15000);
    });

    test("stores small files inline", async () => {
      const smallContent = "small content";

      await Effect.runPromise(fs.writeFile("/small.txt", smallContent));
      const retrieved = await Effect.runPromise(fs.readFile("/small.txt"));

      expect(retrieved).toBe(smallContent);
    });

    test("handles transition from inline to blob storage", async () => {
      await Effect.runPromise(fs.writeFile("/file.txt", "small"));
      await Effect.runPromise(
        fs.writeFile("/file.txt", "x".repeat(15000))
      );

      const content = await Effect.runPromise(fs.readFile("/file.txt"));
      expect(content.length).toBe(15000);
    });
  });

  describe("Version Control", () => {
    test("getRootHeads returns document heads", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "content"));

      const heads = await Effect.runPromise(fs.getRootHeads());

      expect(heads).toBeDefined();
      expect(Array.isArray(heads)).toBe(true);
      expect(heads.length).toBeGreaterThan(0);
    });

    test("getFileHistory returns operation log", async () => {
      await Effect.runPromise(fs.writeFile("/test.txt", "v1"));
      await Effect.runPromise(fs.writeFile("/test.txt", "v2"));
      await Effect.runPromise(fs.writeFile("/test.txt", "v3"));

      const history = await Effect.runPromise(fs.getFileHistory("/test.txt"));

      expect(history).toBeDefined();
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThanOrEqual(3);
    });

    test("getAllDocumentIds returns created document IDs", async () => {
      await Effect.runPromise(fs.writeFile("/file1.txt", "content1"));
      await Effect.runPromise(fs.writeFile("/file2.txt", "content2"));

      const ids = await Effect.runPromise(fs.getAllDocumentIds());

      expect(ids.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Edge Cases", () => {
    test("handles empty file content", async () => {
      await Effect.runPromise(fs.writeFile("/empty.txt", ""));

      const content = await Effect.runPromise(fs.readFile("/empty.txt"));
      expect(content).toBe("");
    });

    test("handles files with special characters in name", async () => {
      await Effect.runPromise(
        fs.writeFile("/test-file_123.txt", "content")
      );

      const content = await Effect.runPromise(
        fs.readFile("/test-file_123.txt")
      );
      expect(content).toBe("content");
    });

    test("readdir on empty directory returns empty array", async () => {
      await Effect.runPromise(fs.mkdir("/emptydir"));

      const entries = await Effect.runPromise(fs.readdir("/emptydir"));
      expect(entries).toEqual([]);
    });

    test("multiple concurrent writes", async () => {
      const writes = [
        Effect.runPromise(fs.writeFile("/file1.txt", "content1")),
        Effect.runPromise(fs.writeFile("/file2.txt", "content2")),
        Effect.runPromise(fs.writeFile("/file3.txt", "content3")),
      ];

      await Promise.all(writes);

      const content1 = await Effect.runPromise(fs.readFile("/file1.txt"));
      const content2 = await Effect.runPromise(fs.readFile("/file2.txt"));
      const content3 = await Effect.runPromise(fs.readFile("/file3.txt"));

      expect(content1).toBe("content1");
      expect(content2).toBe("content2");
      expect(content3).toBe("content3");
    });
  });
});
