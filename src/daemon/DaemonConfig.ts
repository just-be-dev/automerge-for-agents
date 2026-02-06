import { Context } from "effect"

export interface DaemonConfigShape {
  socketPath: string
  dataDir: string
}

export class DaemonConfig extends Context.Tag("DaemonConfig")<
  DaemonConfig,
  DaemonConfigShape
>() {}
