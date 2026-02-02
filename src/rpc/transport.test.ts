import { test, expect, describe } from "bun:test";
import { RpcRequest, RpcResponse } from "./schema";

describe("RPC Transport Message Format", () => {
  test("RPC request serializes to JSON with newline", () => {
    const request: RpcRequest = {
      id: 123,
      method: "read",
      params: { path: "/test.txt" },
    };

    const serialized = JSON.stringify(request) + "\n";
    expect(serialized).toContain('"id":123');
    expect(serialized).toContain('"method":"read"');
    expect(serialized).toEndWith("\n");
  });

  test("RPC response serializes to JSON with newline", () => {
    const response: RpcResponse = {
      id: 123,
      result: { content: "file content" },
    };

    const serialized = JSON.stringify(response) + "\n";
    expect(serialized).toContain('"id":123');
    expect(serialized).toContain('"result"');
    expect(serialized).toEndWith("\n");
  });

  test("Error response serializes correctly", () => {
    const response: RpcResponse = {
      id: 123,
      error: {
        message: "File not found",
        code: "ENOENT",
      },
    };

    const serialized = JSON.stringify(response) + "\n";
    const parsed = JSON.parse(serialized);

    expect(parsed.id).toBe(123);
    expect(parsed.error.message).toBe("File not found");
    expect(parsed.error.code).toBe("ENOENT");
  });

  test("Multiple messages can be separated by newlines", () => {
    const request1: RpcRequest = {
      id: 1,
      method: "read",
      params: { path: "/file1.txt" },
    };

    const request2: RpcRequest = {
      id: 2,
      method: "write",
      params: { path: "/file2.txt", content: "data" },
    };

    const combined = JSON.stringify(request1) + "\n" + JSON.stringify(request2) + "\n";
    const lines = combined.split("\n").filter((line) => line.trim());

    expect(lines.length).toBe(2);

    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);

    expect(parsed1.id).toBe(1);
    expect(parsed2.id).toBe(2);
  });

  test("Line-based protocol handles partial messages", () => {
    const request: RpcRequest = {
      id: 123,
      method: "read",
      params: { path: "/test.txt" },
    };

    const message = JSON.stringify(request) + "\n";

    // Split message into chunks
    const part1 = message.slice(0, message.length / 2);
    const part2 = message.slice(message.length / 2);

    // Buffer accumulation
    let buffer = "";
    buffer += part1; // Incomplete message
    let lines = buffer.split("\n");
    buffer = lines.pop() || "";

    expect(lines.length).toBe(0); // No complete lines yet

    buffer += part2; // Complete the message
    lines = buffer.split("\n");
    buffer = lines.pop() || "";

    expect(lines.length).toBe(1); // Now we have a complete line
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe(123);
  });

  test("Empty lines should be ignored", () => {
    const messages = "\n\n" + JSON.stringify({ id: 1, method: "test", params: {} }) + "\n\n";
    const lines = messages.split("\n").filter((line) => line.trim());

    expect(lines.length).toBe(1);
  });

  test("Request ID increments for multiple requests", () => {
    let id = 1;

    const req1: RpcRequest = { id: id++, method: "read", params: {} };
    const req2: RpcRequest = { id: id++, method: "write", params: {} };
    const req3: RpcRequest = { id: id++, method: "stat", params: {} };

    expect(req1.id).toBe(1);
    expect(req2.id).toBe(2);
    expect(req3.id).toBe(3);
  });
});
