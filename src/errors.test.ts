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
  type FileSystemError,
  type NetworkError,
  type ExecutionError,
} from "./errors";

describe("Error Types", () => {
  test("FileNotFoundError creates with correct properties", () => {
    const error = new FileNotFoundError({ path: "/test/file.txt" });
    expect(error._tag).toBe("FileNotFoundError");
    expect(error.path).toBe("/test/file.txt");
  });

  test("FileReadError creates with path and cause", () => {
    const error = new FileReadError({
      path: "/test/file.txt",
      cause: "Permission denied",
    });
    expect(error._tag).toBe("FileReadError");
    expect(error.path).toBe("/test/file.txt");
    expect(error.cause).toBe("Permission denied");
  });

  test("FileWriteError creates with path and cause", () => {
    const error = new FileWriteError({
      path: "/test/file.txt",
      cause: "Disk full",
    });
    expect(error._tag).toBe("FileWriteError");
    expect(error.path).toBe("/test/file.txt");
    expect(error.cause).toBe("Disk full");
  });

  test("DirectoryNotFoundError creates with correct properties", () => {
    const error = new DirectoryNotFoundError({ path: "/test/dir" });
    expect(error._tag).toBe("DirectoryNotFoundError");
    expect(error.path).toBe("/test/dir");
  });

  test("ConnectionClosedError creates with reason", () => {
    const error = new ConnectionClosedError({
      reason: "Socket closed unexpectedly",
    });
    expect(error._tag).toBe("ConnectionClosedError");
    expect(error.reason).toBe("Socket closed unexpectedly");
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

  test("RpcError creates with method and cause", () => {
    const error = new RpcError({ method: "read", cause: "Invalid method" });
    expect(error._tag).toBe("RpcError");
    expect(error.method).toBe("read");
    expect(error.cause).toBe("Invalid method");
  });

  test("InitializationError creates with component and cause", () => {
    const error = new InitializationError({
      component: "daemon",
      cause: "Failed to start daemon",
    });
    expect(error._tag).toBe("InitializationError");
    expect(error.component).toBe("daemon");
    expect(error.cause).toBe("Failed to start daemon");
  });
});

describe("Error Union Types", () => {
  test("FileSystemError includes all filesystem errors", () => {
    const fileNotFound = new FileNotFoundError({ path: "/test" });
    const fileRead = new FileReadError({ path: "/test", cause: "error" });
    const fileWrite = new FileWriteError({ path: "/test", cause: "error" });
    const dirNotFound = new DirectoryNotFoundError({ path: "/test" });

    // Type assertion checks - these compile if unions are correct
    const _errors: FileSystemError[] = [
      fileNotFound,
      fileRead,
      fileWrite,
      dirNotFound,
    ];
    expect(_errors.length).toBe(4);
  });

  test("NetworkError includes connection-related errors", () => {
    const connectionClosed = new ConnectionClosedError({ reason: "closed" });

    const _errors: NetworkError[] = [connectionClosed];
    expect(_errors.length).toBe(1);
  });

  test("ExecutionError includes bash execution errors", () => {
    const bashError = new BashExecutionError({
      command: "ls",
      exitCode: 1,
      stderr: "error",
    });

    const _errors: ExecutionError[] = [bashError];
    expect(_errors.length).toBe(1);
  });

  test("RpcError has correct fields", () => {
    const rpcError = new RpcError({ method: "read", cause: "error" });

    expect(rpcError._tag).toBe("RpcError");
    expect(rpcError.method).toBe("read");
  });
});
