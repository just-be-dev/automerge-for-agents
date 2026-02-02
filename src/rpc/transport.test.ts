import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Effect, Stream, Chunk } from "effect";
import { makeServerConnection, connectClient } from "./transport";
import { RpcRequest, RpcResponse } from "./schema";

describe("RPC Transport", () => {
  describe("Server Connection", () => {
    test("processes complete line-delimited messages", async () => {
      const request: RpcRequest = {
        id: "req-1",
        method: "read",
        params: { path: "/test.txt" },
      };

      const message = JSON.stringify(request) + "\n";
      const input = Stream.make(Chunk.fromIterable(new TextEncoder().encode(message)));

      const messages: RpcRequest[] = [];
      const connection = makeServerConnection(
        input,
        (msg) => {
          messages.push(msg);
          return Effect.void;
        },
        Effect.void
      );

      await Effect.runPromise(Effect.fork(connection));
      await Bun.sleep(100); // Give time for processing

      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe("req-1");
      expect(messages[0].method).toBe("read");
    });

    test("buffers partial messages across chunks", async () => {
      const request: RpcRequest = {
        id: "req-2",
        method: "write",
        params: { path: "/test.txt", content: "data" },
      };

      const message = JSON.stringify(request) + "\n";
      const encoder = new TextEncoder();

      // Split message into two chunks
      const part1 = message.slice(0, message.length / 2);
      const part2 = message.slice(message.length / 2);

      const input = Stream.make(
        Chunk.fromIterable(encoder.encode(part1)),
        Chunk.fromIterable(encoder.encode(part2))
      );

      const messages: RpcRequest[] = [];
      const connection = makeServerConnection(
        input,
        (msg) => {
          messages.push(msg);
          return Effect.void;
        },
        Effect.void
      );

      await Effect.runPromise(Effect.fork(connection));
      await Bun.sleep(100);

      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe("req-2");
    });

    test("handles multiple messages in single chunk", async () => {
      const request1: RpcRequest = {
        id: "req-1",
        method: "read",
        params: { path: "/file1.txt" },
      };
      const request2: RpcRequest = {
        id: "req-2",
        method: "read",
        params: { path: "/file2.txt" },
      };

      const message =
        JSON.stringify(request1) + "\n" +
        JSON.stringify(request2) + "\n";

      const input = Stream.make(Chunk.fromIterable(new TextEncoder().encode(message)));

      const messages: RpcRequest[] = [];
      const connection = makeServerConnection(
        input,
        (msg) => {
          messages.push(msg);
          return Effect.void;
        },
        Effect.void
      );

      await Effect.runPromise(Effect.fork(connection));
      await Bun.sleep(100);

      expect(messages.length).toBe(2);
      expect(messages[0].id).toBe("req-1");
      expect(messages[1].id).toBe("req-2");
    });

    test("ignores empty lines", async () => {
      const request: RpcRequest = {
        id: "req-1",
        method: "read",
        params: { path: "/test.txt" },
      };

      const message = "\n\n" + JSON.stringify(request) + "\n\n";
      const input = Stream.make(Chunk.fromIterable(new TextEncoder().encode(message)));

      const messages: RpcRequest[] = [];
      const connection = makeServerConnection(
        input,
        (msg) => {
          messages.push(msg);
          return Effect.void;
        },
        Effect.void
      );

      await Effect.runPromise(Effect.fork(connection));
      await Bun.sleep(100);

      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe("req-1");
    });

    test("calls onClose when stream ends", async () => {
      const input = Stream.empty;
      let closeCalled = false;

      const connection = makeServerConnection(
        input,
        () => Effect.void,
        Effect.sync(() => { closeCalled = true; })
      );

      await Effect.runPromise(connection);

      expect(closeCalled).toBe(true);
    });
  });

  describe("Client Connection", () => {
    test("sends formatted JSON messages", async () => {
      const sentMessages: string[] = [];

      const mockSocket = {
        write: (data: string) => {
          sentMessages.push(data);
        },
        on: () => {},
        once: () => {},
        end: () => {},
      } as any;

      const client = connectClient(() => Promise.resolve(mockSocket));

      const request: RpcRequest = {
        id: "req-1",
        method: "read",
        params: { path: "/test.txt" },
      };

      await Effect.runPromise(client.send(request));

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toBe(JSON.stringify(request) + "\n");
    });

    test("handles response matching by ID", async () => {
      let dataCallback: ((data: Buffer) => void) | null = null;

      const mockSocket = {
        write: () => {},
        on: (event: string, callback: any) => {
          if (event === "data") {
            dataCallback = callback;
          }
        },
        once: () => {},
        end: () => {},
      } as any;

      const client = connectClient(() => Promise.resolve(mockSocket));

      const request: RpcRequest = {
        id: "req-123",
        method: "read",
        params: { path: "/test.txt" },
      };

      const responsePromise = Effect.runPromise(client.request(request));

      // Simulate server response
      const response: RpcResponse = {
        id: "req-123",
        type: "success",
        result: { content: "file content" },
      };

      if (dataCallback) {
        dataCallback(Buffer.from(JSON.stringify(response) + "\n"));
      }

      const result = await responsePromise;

      expect(result.id).toBe("req-123");
      expect(result.type).toBe("success");
    });

    test("handles multiple concurrent requests", async () => {
      let dataCallback: ((data: Buffer) => void) | null = null;

      const mockSocket = {
        write: () => {},
        on: (event: string, callback: any) => {
          if (event === "data") {
            dataCallback = callback;
          }
        },
        once: () => {},
        end: () => {},
      } as any;

      const client = connectClient(() => Promise.resolve(mockSocket));

      const request1: RpcRequest = {
        id: "req-1",
        method: "read",
        params: { path: "/file1.txt" },
      };

      const request2: RpcRequest = {
        id: "req-2",
        method: "read",
        params: { path: "/file2.txt" },
      };

      const promise1 = Effect.runPromise(client.request(request1));
      const promise2 = Effect.runPromise(client.request(request2));

      // Send responses in reverse order
      const response2: RpcResponse = {
        id: "req-2",
        type: "success",
        result: { content: "content2" },
      };

      const response1: RpcResponse = {
        id: "req-1",
        type: "success",
        result: { content: "content1" },
      };

      if (dataCallback) {
        dataCallback(Buffer.from(JSON.stringify(response2) + "\n"));
        dataCallback(Buffer.from(JSON.stringify(response1) + "\n"));
      }

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.id).toBe("req-1");
      expect(result2.id).toBe("req-2");
    });
  });
});
