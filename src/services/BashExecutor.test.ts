import { test, expect, describe } from "bun:test";
import { Effect, Layer } from "effect";
import { BashExecutor, SimpleBashExecutorLive } from "./BashExecutor";

describe("SimpleBashExecutor", () => {
  const runtime = Layer.toRuntime(SimpleBashExecutorLive).pipe(
    Effect.scoped,
    Effect.runSync
  );

  test("executes successful command", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec("echo 'hello world'", { cwd: process.cwd() })
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
  });

  test("captures stderr output", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec("echo 'error message' >&2", { cwd: process.cwd() })
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.stderr.trim()).toBe("error message");
  });

  test("returns non-zero exit code on command failure", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) => executor.exec("exit 42", { cwd: process.cwd() }))
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(42);
  });

  test("executes command in specified working directory", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) => executor.exec("pwd", { cwd: "/tmp" }))
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  test("handles commands with pipes", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec("echo -e 'line1\\nline2\\nline3' | grep line2", {
          cwd: process.cwd(),
        })
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("line2");
  });

  test("handles commands with environment variables", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec("TEST_VAR=hello; echo $TEST_VAR", { cwd: process.cwd() })
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  test("handles multi-line commands", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec(
          `
            x=5
            y=3
            echo $((x + y))
          `,
          { cwd: process.cwd() }
        )
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("8");
  });

  test("handles command with special characters", async () => {
    const program = BashExecutor.pipe(
      Effect.flatMap((executor) =>
        executor.exec("echo 'test $VAR and \"quotes\"'", { cwd: process.cwd() })
      )
    );

    const result = await Effect.runPromise(program.pipe(Effect.provide(runtime)));

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("test $VAR and \"quotes\"");
  });
});
