/**
 * Layer composition for automerge-fsd
 *
 * Composes all service layers into a single DaemonLive layer
 * that can be provided to the daemon runtime.
 */

import { Layer } from "effect"
import { StorageAdapterLive } from "../services/StorageAdapter"
import { BlobStoreLive } from "../services/BlobStore"
import { AutomergeFsLive } from "../services/AutomergeFs"
import { BashExecutorLive } from "../services/BashExecutor"

export { DaemonConfig, type DaemonConfigShape } from "./DaemonConfig"

/**
 * DaemonLive — composed layer combining all services.
 * Requires DaemonConfig to be provided externally.
 */
export const DaemonLive = BashExecutorLive.pipe(
  Layer.provideMerge(AutomergeFsLive),
  Layer.provideMerge(StorageAdapterLive),
  Layer.provideMerge(BlobStoreLive),
)
