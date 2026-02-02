import { test, expect, describe } from "bun:test";
import { Schema } from "effect";
import {
  ReadParams,
  WriteParams,
  StatParams,
  ReaddirParams,
  MkdirParams,
  BashParams,
  FileStatSchema,
  DirEntrySchema,
  BashResultSchema,
  RpcRequestSchema,
  RpcResponseSchema,
} from "./schema";

describe("RPC Schema Validation", () => {
  describe("Request Parameter Schemas", () => {
    test("ReadParams validates correctly", () => {
      const valid = { path: "/test.txt" };
      const result = Schema.decodeUnknownSync(ReadParams)(valid);
      expect(result.path).toBe("/test.txt");
    });

    test("WriteParams validates with content", () => {
      const valid = { path: "/test.txt", content: "Hello" };
      const result = Schema.decodeUnknownSync(WriteParams)(valid);
      expect(result.path).toBe("/test.txt");
      expect(result.content).toBe("Hello");
    });

    test("StatParams validates correctly", () => {
      const valid = { path: "/test.txt" };
      const result = Schema.decodeUnknownSync(StatParams)(valid);
      expect(result.path).toBe("/test.txt");
    });

    test("ReaddirParams validates correctly", () => {
      const valid = { path: "/testdir" };
      const result = Schema.decodeUnknownSync(ReaddirParams)(valid);
      expect(result.path).toBe("/testdir");
    });

    test("MkdirParams validates with recursive option", () => {
      const valid = { path: "/a/b/c", recursive: true };
      const result = Schema.decodeUnknownSync(MkdirParams)(valid);
      expect(result.path).toBe("/a/b/c");
      expect(result.recursive).toBe(true);
    });

    test("MkdirParams has optional recursive field", () => {
      const valid = { path: "/testdir" };
      const result = Schema.decodeUnknownSync(MkdirParams)(valid);
      expect(result.recursive).toBeUndefined();
    });

    test("BashParams validates with command and cwd", () => {
      const valid = { command: "ls -la", cwd: "/tmp" };
      const result = Schema.decodeUnknownSync(BashParams)(valid);
      expect(result.command).toBe("ls -la");
      expect(result.cwd).toBe("/tmp");
    });
  });

  describe("Response Schemas", () => {
    test("FileStatSchema validates file stat", () => {
      const valid = {
        size: 1024,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o644,
        mtime: "2024-01-01T00:00:00Z",
        ctime: "2024-01-01T00:00:00Z",
      };
      const result = Schema.decodeUnknownSync(FileStatSchema)(valid);
      expect(result.isFile).toBe(true);
      expect(result.size).toBe(1024);
      expect(result.mode).toBe(0o644);
    });

    test("FileStatSchema validates directory stat", () => {
      const valid = {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymbolicLink: false,
        mode: 0o755,
        mtime: "2024-01-01T00:00:00Z",
        ctime: "2024-01-01T00:00:00Z",
      };
      const result = Schema.decodeUnknownSync(FileStatSchema)(valid);
      expect(result.isDirectory).toBe(true);
    });

    test("DirEntrySchema validates directory entry", () => {
      const valid = {
        name: "file.txt",
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      };
      const result = Schema.decodeUnknownSync(DirEntrySchema)(valid);
      expect(result.name).toBe("file.txt");
      expect(result.isFile).toBe(true);
    });

    test("BashResultSchema validates bash result", () => {
      const valid = {
        stdout: "output",
        stderr: "error",
        exitCode: 0,
      };
      const result = Schema.decodeUnknownSync(BashResultSchema)(valid);
      expect(result.stdout).toBe("output");
      expect(result.stderr).toBe("error");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("RPC Message Schemas", () => {
    test("RpcRequestSchema validates request with read method", () => {
      const valid = {
        id: 123,
        method: "read",
        params: { path: "/test.txt" },
      };
      const result = Schema.decodeUnknownSync(RpcRequestSchema)(valid);
      expect(result.id).toBe(123);
      expect(result.method).toBe("read");
      expect(result.params).toEqual({ path: "/test.txt" });
    });

    test("RpcRequestSchema validates request with bash method", () => {
      const valid = {
        id: 456,
        method: "bash",
        params: { command: "ls", cwd: "/tmp" },
      };
      const result = Schema.decodeUnknownSync(RpcRequestSchema)(valid);
      expect(result.id).toBe(456);
      expect(result.method).toBe("bash");
    });

    test("RpcResponseSchema validates success response", () => {
      const valid = {
        id: 123,
        result: { content: "file content" },
      };
      const result = Schema.decodeUnknownSync(RpcResponseSchema)(valid);
      expect(result.id).toBe(123);
      expect(result.result).toEqual({ content: "file content" });
      expect(result.error).toBeUndefined();
    });

    test("RpcResponseSchema validates error response", () => {
      const valid = {
        id: 123,
        error: {
          message: "File not found",
          code: "ENOENT",
        },
      };
      const result = Schema.decodeUnknownSync(RpcResponseSchema)(valid);
      expect(result.id).toBe(123);
      expect(result.error?.message).toBe("File not found");
      expect(result.result).toBeUndefined();
    });
  });

  describe("Schema Validation Failures", () => {
    test("ReadParams rejects invalid path type", () => {
      const invalid = { path: 123 };
      expect(() => Schema.decodeUnknownSync(ReadParams)(invalid)).toThrow();
    });

    test("WriteParams rejects missing content", () => {
      const invalid = { path: "/test.txt" };
      expect(() => Schema.decodeUnknownSync(WriteParams)(invalid)).toThrow();
    });

    test("BashParams rejects missing command", () => {
      const invalid = { cwd: "/tmp" };
      expect(() => Schema.decodeUnknownSync(BashParams)(invalid)).toThrow();
    });

    test("FileStatSchema rejects invalid field type", () => {
      const invalid = {
        size: "not-a-number",
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o644,
        mtime: "2024-01-01T00:00:00Z",
        ctime: "2024-01-01T00:00:00Z",
      };
      expect(() => Schema.decodeUnknownSync(FileStatSchema)(invalid)).toThrow();
    });

    test("RpcRequestSchema rejects missing id", () => {
      const invalid = {
        method: "read",
        params: { path: "/test.txt" },
      };
      expect(() =>
        Schema.decodeUnknownSync(RpcRequestSchema)(invalid)
      ).toThrow();
    });

    test("RpcResponseSchema rejects invalid id type", () => {
      const invalid = {
        id: "not-a-number",
        result: {},
      };
      expect(() =>
        Schema.decodeUnknownSync(RpcResponseSchema)(invalid)
      ).toThrow();
    });
  });
});
