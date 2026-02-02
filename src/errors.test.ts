import { test, expect, describe } from "bun:test";
import {
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  DirectoryNotFoundError,
  ConnectionClosedError,
  BashExecutionError,
  RpcError,
  InitializationError,
  FileSystemErrors,
  ConnectionErrors,
  BashErrors,
  RpcErrors,
} from "./errors";

describe("Error Types", () => {
  test("FileNotFoundError creates with correct properties", () => {
    const error = new FileNotFoundError({ path: "/test/file.txt" });
    expect(error._tag).toBe("FileNotFoundError");
    expect(error.path).toBe("/test/file.txt");
  });

  test("FileReadError creates with path and message", () => {
    const error = new FileReadError({
      path: "/test/file.txt",
      message: "Permission denied",
    });
    expect(error._tag).toBe("FileReadError");
    expect(error.path).toBe("/test/file.txt");
    expect(error.message).toBe("Permission denied");
  });

  test("FileWriteError creates with path and message", () => {
    const error = new FileWriteError({
      path: "/test/file.txt",
      message: "Disk full",
    });
    expect(error._tag).toBe("FileWriteError");
    expect(error.path).toBe("/test/file.txt");
    expect(error.message).toBe("Disk full");
  });

  test("DirectoryNotFoundError creates with correct properties", () => {
    const error = new DirectoryNotFoundError({ path: "/test/dir" });
    expect(error._tag).toBe("DirectoryNotFoundError");
    expect(error.path).toBe("/test/dir");
  });

  test("ConnectionClosedError creates with message", () => {
    const error = new ConnectionClosedError({
      message: "Socket closed unexpectedly",
    });
    expect(error._tag).toBe("ConnectionClosedError");
    expect(error.message).toBe("Socket closed unexpectedly");
  });

  test("BashExecutionError creates with command and exitCode", () => {
    const error = new BashExecutionError({
      command: "ls -la",
      exitCode: 1,
      stderr: "Directory not found",
    });
    expect(error._tag).toBe("BashExecutionError");
    expect(error.command).toBe("ls -la");
    expect(error.exitCode).toBe(1);
    expect(error.stderr).toBe("Directory not found");
  });

  test("RpcError creates with message", () => {
    const error = new RpcError({ message: "Invalid method" });
    expect(error._tag).toBe("RpcError");
    expect(error.message).toBe("Invalid method");
  });

  test("InitializationError creates with message", () => {
    const error = new InitializationError({
      message: "Failed to start daemon",
    });
    expect(error._tag).toBe("InitializationError");
    expect(error.message).toBe("Failed to start daemon");
  });
});

describe("Error Union Types", () => {
  test("FileSystemErrors includes all filesystem errors", () => {
    const fileNotFound = new FileNotFoundError({ path: "/test" });
    const fileRead = new FileReadError({ path: "/test", message: "error" });
    const fileWrite = new FileWriteError({ path: "/test", message: "error" });
    const dirNotFound = new DirectoryNotFoundError({ path: "/test" });

    // Type assertion checks - these compile if unions are correct
    const _errors: FileSystemErrors[] = [
      fileNotFound,
      fileRead,
      fileWrite,
      dirNotFound,
    ];
    expect(_errors.length).toBe(4);
  });

  test("ConnectionErrors includes connection-related errors", () => {
    const connectionClosed = new ConnectionClosedError({ message: "closed" });

    const _errors: ConnectionErrors[] = [connectionClosed];
    expect(_errors.length).toBe(1);
  });

  test("BashErrors includes bash execution errors", () => {
    const bashError = new BashExecutionError({
      command: "ls",
      exitCode: 1,
      stderr: "error",
    });

    const _errors: BashErrors[] = [bashError];
    expect(_errors.length).toBe(1);
  });

  test("RpcErrors includes RPC-related errors", () => {
    const rpcError = new RpcError({ message: "error" });

    const _errors: RpcErrors[] = [rpcError];
    expect(_errors.length).toBe(1);
  });
});
