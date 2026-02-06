/**
 * Unix Socket Transport for Effect RPC
 *
 * Provides a simple JSON-over-newline transport for Unix domain sockets.
 */

import { Effect, Ref, Schema, Scope } from "effect"
import type * as Socket from "@effect/platform/Socket"
import { TransportError } from "../errors"
import type { AmfsRouter } from "./router"
import { RpcRequestSchema, type RpcRequest, type RpcResponse } from "./schema"

// =============================================================================
// Server Transport
// =============================================================================

export interface ServerConnection {
  onData: (data: Buffer | string) => Effect.Effect<void>
  onClose: (error?: Error) => Effect.Effect<void>
}

/**
 * Creates a server connection handler for a single client socket.
 * Processes incoming RPC requests through the router.
 */
export const makeServerConnection = (
  socket: { write: (data: string) => void; end: () => void },
  router: AmfsRouter
): Effect.Effect<ServerConnection> =>
  Effect.gen(function* () {
    const bufferRef = yield* Ref.make("")
    const closedRef = yield* Ref.make(false)

    const processLine = (line: string) =>
      Effect.gen(function* () {
        let request: RpcRequest
        try {
          const parsed = JSON.parse(line)
          const decoded = Schema.decodeUnknownSync(RpcRequestSchema)(parsed)
          request = decoded
        } catch {
          return
        }

        const { id, method, params } = request

        // Process through router
        const result = yield* router.handle(method, params).pipe(
          Effect.map((result) => ({ id, result })),
          Effect.catchAll((error) =>
            Effect.succeed({
              id,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
          )
        )

        // Send response
        const response: RpcResponse = result
        socket.write(JSON.stringify(response) + "\n")
      })

    return {
      onData: (data: Buffer | string) =>
        Effect.gen(function* () {
          const closed = yield* Ref.get(closedRef)
          if (closed) return

          const str = typeof data === "string" ? data : data.toString("utf-8")
          const currentBuffer = yield* Ref.get(bufferRef)
          const newBuffer = currentBuffer + str

          const lines = newBuffer.split("\n")
          yield* Ref.set(bufferRef, lines.pop() || "")

          for (const line of lines) {
            if (line.trim()) {
              yield* processLine(line).pipe(
                Effect.catchAll((e) =>
                  Effect.sync(() =>
                    console.error("Error processing request:", e)
                  )
                )
              )
            }
          }
        }),

      onClose: (error?: Error) =>
        Effect.gen(function* () {
          yield* Ref.set(closedRef, true)
          if (error) {
            console.error("Connection error:", error)
          }
        }),
    }
  })

/**
 * Handles a connection from an @effect/platform SocketServer.
 * Processes JSON-over-newline RPC requests through the router.
 */
export const handleConnection = (
  socket: Socket.Socket,
  router: AmfsRouter
): Effect.Effect<void, Socket.SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const write = yield* socket.writer
    const bufferRef = yield* Ref.make("")

    const processLine = (line: string) =>
      Effect.gen(function* () {
        let request: RpcRequest
        try {
          const parsed = JSON.parse(line)
          const decoded = Schema.decodeUnknownSync(RpcRequestSchema)(parsed)
          request = decoded
        } catch {
          return
        }

        const { id, method, params } = request

        const result = yield* router.handle(method, params).pipe(
          Effect.map((result) => ({ id, result })),
          Effect.catchAll((error) =>
            Effect.succeed({
              id,
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            })
          )
        )

        const response: RpcResponse = result
        yield* write(JSON.stringify(response) + "\n")
      })

    yield* socket.run((data: Uint8Array) =>
      Effect.gen(function* () {
        const str = new TextDecoder().decode(data)
        const currentBuffer = yield* Ref.get(bufferRef)
        const newBuffer = currentBuffer + str

        const lines = newBuffer.split("\n")
        yield* Ref.set(bufferRef, lines.pop() || "")

        for (const line of lines) {
          if (line.trim()) {
            yield* processLine(line).pipe(
              Effect.catchAll((e) =>
                Effect.sync(() =>
                  console.error("Error processing request:", e)
                )
              )
            )
          }
        }
      })
    )
  })

// =============================================================================
// Client Transport
// =============================================================================

export interface ClientConnection {
  call: <Req, Res>(request: Req) => Effect.Effect<Res, TransportError>
  close: () => Effect.Effect<void>
}

/**
 * Creates a client connection to the daemon via Unix socket.
 */
export const connectClient = (
  socketPath: string
): Effect.Effect<ClientConnection, TransportError> =>
  Effect.async((resume) => {
    let nextId = 1
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >()
    let buffer = ""
    let closed = false

    const processLine = (line: string) => {
      try {
        const msg = JSON.parse(line) as RpcResponse
        const handler = pending.get(msg.id)
        if (handler) {
          pending.delete(msg.id)
          if (msg.error) {
            handler.reject(new Error(msg.error.message))
          } else {
            handler.resolve(msg.result)
          }
        }
      } catch (e) {
        console.error("Failed to parse response:", e)
      }
    }

    Bun.connect({
      unix: socketPath,
      socket: {
        data(_socket, data) {
          const str =
            typeof data === "string" ? data : data.toString("utf-8")
          buffer += str

          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (line.trim()) {
              processLine(line)
            }
          }
        },
        open(socket) {
          const connection: ClientConnection = {
            call: <Req, Res>(request: Req) =>
              Effect.async<Res, TransportError>((resumeCall) => {
                if (closed) {
                  resumeCall(
                    Effect.fail(
                      new TransportError({
                        message: "Connection closed",
                      })
                    )
                  )
                  return
                }

                const id = nextId++
                const msg: RpcRequest = {
                  id,
                  method: (request as { _tag?: string })._tag ?? "unknown",
                  params: request,
                }

                pending.set(id, {
                  resolve: (value) =>
                    resumeCall(Effect.succeed(value as Res)),
                  reject: (error) =>
                    resumeCall(
                      Effect.fail(
                        new TransportError({
                          message: error.message,
                          cause: error,
                        })
                      )
                    ),
                })

                socket.write(JSON.stringify(msg) + "\n")
              }),

            close: () =>
              Effect.sync(() => {
                closed = true
                for (const [_, handler] of pending) {
                  handler.reject(new Error("Connection closed"))
                }
                pending.clear()
                socket.end()
              }),
          }

          resume(Effect.succeed(connection))
        },
        close(_socket) {
          closed = true
          for (const [_, handler] of pending) {
            handler.reject(new Error("Connection closed"))
          }
          pending.clear()
        },
        error(_socket, error) {
          if (!closed) {
            resume(
              Effect.fail(
                new TransportError({
                  message: `Connection error: ${error.message}`,
                  cause: error,
                })
              )
            )
          }
        },
        connectError(_socket, error) {
          resume(
            Effect.fail(
              new TransportError({
                message: `Failed to connect: ${error.message}`,
                cause: error,
              })
            )
          )
        },
      },
    })
  })
