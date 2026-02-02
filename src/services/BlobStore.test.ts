import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { FileSystemBlobStore } from "./BlobStore";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("FileSystemBlobStore", () => {
  const testDir = "/private/tmp/claude-501/-Users-just-be-Code-automerge-for-agents/09aa6e20-657f-42a6-982c-3825f8f6e853/scratchpad/blobstore-test";
  let store: FileSystemBlobStore;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    store = new FileSystemBlobStore(testDir);
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("set and get blob data", async () => {
    const hash = "abc123def456";
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    await store.set(hash, data);
    const retrieved = await store.get(hash);

    expect(retrieved).toEqual(data);
  });

  test("has returns true for existing blob", async () => {
    const hash = "xyz789";
    const data = new Uint8Array([10, 20, 30]);

    await store.set(hash, data);
    const exists = await store.has(hash);

    expect(exists).toBe(true);
  });

  test("has returns false for non-existing blob", async () => {
    const exists = await store.has("nonexistent");
    expect(exists).toBe(false);
  });

  test("get returns null for non-existing blob", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  test("delete removes blob", async () => {
    const hash = "delete123";
    const data = new Uint8Array([1, 2, 3]);

    await store.set(hash, data);
    expect(await store.has(hash)).toBe(true);

    await store.delete(hash);
    expect(await store.has(hash)).toBe(false);
  });

  test("list returns all stored hashes", async () => {
    await store.set("hash1", new Uint8Array([1]));
    await store.set("hash2", new Uint8Array([2]));
    await store.set("hash3", new Uint8Array([3]));

    const hashes = await store.list();

    expect(hashes).toContain("hash1");
    expect(hashes).toContain("hash2");
    expect(hashes).toContain("hash3");
    expect(hashes.length).toBe(3);
  });

  test("stores blobs in two-level directory structure", async () => {
    const hash = "abcdef1234567890";
    const data = new Uint8Array([100, 200]);

    await store.set(hash, data);

    // First two chars of hash are directory, rest is filename
    const expectedPath = join(testDir, "ab", "cdef1234567890");
    expect(existsSync(expectedPath)).toBe(true);
  });

  test("handles short hashes", async () => {
    const hash = "a";
    const data = new Uint8Array([42]);

    await store.set(hash, data);
    const retrieved = await store.get(hash);

    expect(retrieved).toEqual(data);

    // Short hashes go into "00" directory
    const expectedPath = join(testDir, "00", hash);
    expect(existsSync(expectedPath)).toBe(true);
  });

  test("handles empty data", async () => {
    const hash = "empty123";
    const data = new Uint8Array([]);

    await store.set(hash, data);
    const retrieved = await store.get(hash);

    expect(retrieved).toEqual(data);
    expect(retrieved?.length).toBe(0);
  });

  test("overwrites existing blob", async () => {
    const hash = "overwrite123";
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6, 7]);

    await store.set(hash, data1);
    await store.set(hash, data2);

    const retrieved = await store.get(hash);
    expect(retrieved).toEqual(data2);
  });

  test("list returns empty array when no blobs", async () => {
    const hashes = await store.list();
    expect(hashes).toEqual([]);
  });
});
