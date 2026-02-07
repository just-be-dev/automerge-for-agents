import { test, expect, describe } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { createHandlers } from "./server"
import { AutomergeToolkit } from "./tools"
import type { AutomergeFsService } from "../services/AutomergeFs"
import type { BashExecutorService } from "../services/BashExecutor"
import {
  FileNotFoundError,
  FileWriteError,
  DirectoryCreateError,
  BashExecutionError,
} from "../errors"

// =============================================================================
// Mock Services
// =============================================================================

function mockFsService(overrides: Partial<AutomergeFsService> = {}): AutomergeFsService {
  return {
    readFile: (path) =>
      Effect.succeed(new TextEncoder().encode(`contents of ${path}`)),
    writeFile: () => Effect.void,
    appendFile: () => Effect.void,
    stat: () =>
      Effect.succeed({
        size: 42,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o644,
        mtime: "2025-01-01T00:00:00.000Z",
        ctime: "2025-01-01T00:00:00.000Z",
      }),
    readdir: () =>
      Effect.succeed([
        { name: "file.txt", isFile: true, isDirectory: false, isSymbolicLink: false },
        { name: "subdir", isFile: false, isDirectory: true, isSymbolicLink: false },
      ]),
    mkdir: () => Effect.void,
    unlink: () => Effect.void,
    exists: () => Effect.succeed(true),
    rename: () => Effect.void,
    copy: () => Effect.void,
    getRootHeads: () => Effect.succeed(["abc123", "def456"]),
    getFileHeads: () => Effect.succeed(["aaa111"]),
    getFileHistory: () =>
      Effect.succeed([
        { hash: "h1", actor: "a1", seq: 1, timestamp: 1000, message: null },
      ]),
    getFileAt: () => Effect.succeed("file content at version"),
    diff: () => Effect.succeed([{ action: "put", path: ["content"], value: "new" }]),
    getRootDoc: () => Effect.succeed({ operationLog: [{ seq: 1 }] }),
    getAllDocumentIds: () => Effect.succeed(["doc1"]),
    getAllBlobHashes: () => Effect.succeed(["blob1"]),
    ...overrides,
  }
}

function mockBashService(overrides: Partial<BashExecutorService> = {}): BashExecutorService {
  return {
    exec: (command) =>
      Effect.succeed({
        stdout: `ran: ${command}`,
        stderr: "",
        exitCode: 0,
      }),
    ...overrides,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("MCP server tools", () => {
  // ----- read_file ----------------------------------------------------------

  test("read_file returns file content", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(handlers.read_file({ path: "/hello.txt" }))
    expect(result).toBe("contents of /hello.txt")
  })

  test("read_file returns error for missing file", async () => {
    const handlers = createHandlers(
      mockFsService({
        readFile: (path) => Effect.fail(new FileNotFoundError({ path })),
      }),
      mockBashService(),
    )
    const exit = await Effect.runPromiseExit(handlers.read_file({ path: "/missing" }))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ----- write_file ---------------------------------------------------------

  test("write_file succeeds", async () => {
    let capturedPath = ""
    let capturedContent: string | Uint8Array = ""
    const handlers = createHandlers(
      mockFsService({
        writeFile: (path, content) => {
          capturedPath = path
          capturedContent = content
          return Effect.void
        },
      }),
      mockBashService(),
    )
    const result = await Effect.runPromise(
      handlers.write_file({ path: "/out.txt", content: "hello" }),
    )
    expect(result).toBe("OK")
    expect(capturedPath).toBe("/out.txt")
    expect(capturedContent).toBe("hello")
  })

  test("write_file decodes base64 encoding", async () => {
    let capturedContent: string | Uint8Array = ""
    const handlers = createHandlers(
      mockFsService({
        writeFile: (_path, content) => {
          capturedContent = content
          return Effect.void
        },
      }),
      mockBashService(),
    )
    const encoded = Buffer.from("binary data").toString("base64")
    await Effect.runPromise(
      handlers.write_file({ path: "/bin", content: encoded, encoding: "base64" }),
    )
    expect(Buffer.from(capturedContent as unknown as Uint8Array).toString()).toBe(
      "binary data",
    )
  })

  test("write_file returns error on failure", async () => {
    const handlers = createHandlers(
      mockFsService({
        writeFile: (path) =>
          Effect.fail(new FileWriteError({ path, cause: "disk full" })),
      }),
      mockBashService(),
    )
    const exit = await Effect.runPromiseExit(
      handlers.write_file({ path: "/fail", content: "x" }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ----- list_directory -----------------------------------------------------

  test("list_directory returns entries", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(
      handlers.list_directory({ path: "/" }),
    )
    const data = JSON.parse(result)
    expect(data).toHaveLength(2)
    expect(data[0].name).toBe("file.txt")
    expect(data[1].isDirectory).toBe(true)
  })

  // ----- create_directory ---------------------------------------------------

  test("create_directory succeeds with recursive", async () => {
    let capturedPath = ""
    let capturedRecursive = false
    const handlers = createHandlers(
      mockFsService({
        mkdir: (path, opts) => {
          capturedPath = path
          capturedRecursive = opts?.recursive ?? false
          return Effect.void
        },
      }),
      mockBashService(),
    )
    await Effect.runPromise(
      handlers.create_directory({ path: "/new/dir", recursive: true }),
    )
    expect(capturedPath).toBe("/new/dir")
    expect(capturedRecursive).toBe(true)
  })

  // ----- remove -------------------------------------------------------------

  test("remove succeeds", async () => {
    let capturedPath = ""
    const handlers = createHandlers(
      mockFsService({
        unlink: (path) => {
          capturedPath = path
          return Effect.void
        },
      }),
      mockBashService(),
    )
    await Effect.runPromise(handlers.remove({ path: "/old.txt" }))
    expect(capturedPath).toBe("/old.txt")
  })

  // ----- stat ---------------------------------------------------------------

  test("stat returns metadata", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(handlers.stat({ path: "/f" }))
    const data = JSON.parse(result)
    expect(data.size).toBe(42)
    expect(data.isFile).toBe(true)
  })

  // ----- exists -------------------------------------------------------------

  test("exists returns boolean", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(handlers.exists({ path: "/yes" }))
    expect(JSON.parse(result)).toBe(true)
  })

  // ----- move ---------------------------------------------------------------

  test("move calls rename", async () => {
    const paths: string[] = []
    const handlers = createHandlers(
      mockFsService({
        rename: (a, b) => {
          paths.push(a, b)
          return Effect.void
        },
      }),
      mockBashService(),
    )
    await Effect.runPromise(
      handlers.move({ oldPath: "/a", newPath: "/b" }),
    )
    expect(paths).toEqual(["/a", "/b"])
  })

  // ----- copy ---------------------------------------------------------------

  test("copy calls copy service", async () => {
    const paths: string[] = []
    const handlers = createHandlers(
      mockFsService({
        copy: (s, d) => {
          paths.push(s, d)
          return Effect.void
        },
      }),
      mockBashService(),
    )
    await Effect.runPromise(
      handlers.copy({ src: "/a", dest: "/b" }),
    )
    expect(paths).toEqual(["/a", "/b"])
  })

  // ----- bash ---------------------------------------------------------------

  test("bash executes command and returns result", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(
      handlers.bash({ command: "echo hello" }),
    )
    const data = JSON.parse(result)
    expect(data.stdout).toBe("ran: echo hello")
    expect(data.exitCode).toBe(0)
  })

  test("bash returns error on failure", async () => {
    const handlers = createHandlers(
      mockFsService(),
      mockBashService({
        exec: (command) =>
          Effect.fail(
            new BashExecutionError({ command, exitCode: 1, stderr: "bad" }),
          ),
      }),
    )
    const exit = await Effect.runPromiseExit(
      handlers.bash({ command: "fail" }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  // ----- snapshot -----------------------------------------------------------

  test("snapshot returns heads", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(
      handlers.snapshot({ name: "v1" }),
    )
    const data = JSON.parse(result)
    expect(data.heads).toEqual(["abc123", "def456"])
    expect(data.name).toBe("v1")
    expect(data.timestamp).toBeGreaterThan(0)
  })

  // ----- history ------------------------------------------------------------

  test("history returns file history when path provided", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(
      handlers.history({ path: "/file.txt" }),
    )
    const data = JSON.parse(result)
    expect(data.type).toBe("file")
    expect(data.path).toBe("/file.txt")
    expect(data.history).toHaveLength(1)
  })

  test("history returns root history when no path", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(handlers.history({}))
    const data = JSON.parse(result)
    expect(data.type).toBe("root")
    expect(data.operationLog).toHaveLength(1)
  })

  // ----- diff ---------------------------------------------------------------

  test("diff returns patches", async () => {
    const handlers = createHandlers(mockFsService(), mockBashService())
    const result = await Effect.runPromise(
      handlers.diff({ path: "/f", fromHeads: ["a"], toHeads: ["b"] }),
    )
    const data = JSON.parse(result)
    expect(data[0].action).toBe("put")
  })

  // ----- toolkit tools list -------------------------------------------------

  test("toolkit has all 13 tools", () => {
    const names = Object.keys(AutomergeToolkit.tools).sort()
    expect(names).toEqual([
      "bash",
      "copy",
      "create_directory",
      "diff",
      "exists",
      "history",
      "list_directory",
      "move",
      "read_file",
      "remove",
      "snapshot",
      "stat",
      "write_file",
    ])
  })
})

// =============================================================================
// Full Toolkit Flow Tests (toLayer → resolve → handle)
// =============================================================================

describe("Toolkit resolution flow", () => {
  const makeHandlersLayer = (
    fsOverrides: Partial<AutomergeFsService> = {},
    bashOverrides: Partial<BashExecutorService> = {},
  ) =>
    AutomergeToolkit.toLayer(
      Effect.gen(function* () {
        return createHandlers(
          mockFsService(fsOverrides),
          mockBashService(bashOverrides),
        )
      }),
    )

  test("resolving toolkit as Effect and calling handle works", async () => {
    const layer = makeHandlersLayer()

    const program = Effect.gen(function* () {
      // AutomergeToolkit is an Effect<WithHandler, never, HandlersFor<...>>
      // Yielding it resolves the handlers from the context
      const toolkit = yield* AutomergeToolkit
      const result = yield* toolkit.handle("read_file", { path: "/test.txt" })
      return result
    }).pipe(Effect.provide(layer))

    const result = await Effect.runPromise(program)
    expect(result.isFailure).toBe(false)
    expect(result.result).toBe("contents of /test.txt")
  })

  test("toolkit handle returns failure with informative message", async () => {
    const layer = makeHandlersLayer({
      mkdir: (path) =>
        Effect.fail(new DirectoryCreateError({ path, cause: new Error(`ENOENT: no such directory: ${path}`) })),
    })

    const program = Effect.gen(function* () {
      const toolkit = yield* AutomergeToolkit
      const result = yield* toolkit.handle("create_directory", { path: "/deep/nested" })
      return result
    }).pipe(Effect.provide(layer))

    const result = await Effect.runPromise(program)
    expect(result.isFailure).toBe(true)
    // After the toFailure fix, the result should contain useful error info
    expect(result.result).not.toBe("")
    expect(typeof result.result).toBe("string")
  })

  test("create_directory defaults recursive to false", async () => {
    let capturedRecursive: boolean | undefined
    const layer = makeHandlersLayer({
      mkdir: (_path, opts) => {
        capturedRecursive = opts?.recursive
        return Effect.void
      },
    })

    const program = Effect.gen(function* () {
      const toolkit = yield* AutomergeToolkit
      // Simulate what the LLM sends — no recursive field
      return yield* toolkit.handle("create_directory", { path: "/test" })
    }).pipe(Effect.provide(layer))

    await Effect.runPromise(program)
    expect(capturedRecursive).toBe(false)
  })
})
