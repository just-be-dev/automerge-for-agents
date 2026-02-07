#!/usr/bin/env bun

/**
 * Interactive TUI for browsing Automerge file history
 *
 * Usage:
 *   bun run src/cli/history-viewer.ts <path>
 *
 * Controls:
 *   j/k or arrow keys — navigate history
 *   d — toggle diff view
 *   q — quit
 */

import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { DaemonConfig, DaemonLive } from "../daemon/Layer"
import { AutomergeFsInstance } from "../services/AutomergeFs"
import type { AutomergeFsMultiDoc } from "../services/AutomergeFs"
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  ScrollBoxRenderable,
} from "@opentui/core"
import { createTwoFilesPatch } from "diff"

const filePathArg = process.argv[2]

if (!filePathArg) {
  console.error("Usage: bun run src/cli/history-viewer.ts <path>")
  process.exit(1)
  throw new Error("unreachable")
}

const filePath: string = filePathArg

interface HistoryEntry {
  hash: string
  actor: string
  seq: number
  timestamp: number
  message: string | null
}

async function startTUI(
  fsInstance: AutomergeFsMultiDoc,
  history: HistoryEntry[],
  initialContent: string
) {
  const contentCache = new Map<string, string>()
  let diffMode = false

  // Cache the latest entry content
  const latestHash = history[0]!.hash
  contentCache.set(latestHash, initialContent)

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
  })

  // Root container — full terminal, horizontal layout
  const root = new BoxRenderable(renderer, {
    id: "root",
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    flexDirection: "row",
  })
  renderer.root.add(root)

  // Left panel — history list
  const historyBox = new BoxRenderable(renderer, {
    id: "history-panel",
    width: Math.min(30, Math.floor(renderer.terminalWidth * 0.35)),
    height: renderer.terminalHeight - 1,
    border: true,
    borderStyle: "single",
    borderColor: "#888888",
    flexDirection: "column",
    flexShrink: 0,
  })
  const historyTitle = new TextRenderable(renderer, {
    id: "history-title",
    content: " History ",
    height: 1,
  })
  historyBox.add(historyTitle)

  const selectOptions = history.map((entry, i) => {
    const date = new Date(entry.timestamp)
    const timeStr = date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    const label = `${timeStr} #${history.length - i}`
    return { name: label, description: entry.message ?? "", value: entry.hash }
  })

  const historySelect = new SelectRenderable(renderer, {
    id: "history-select",
    options: selectOptions,
    selectedIndex: 0,
    flexGrow: 1,
  })
  historySelect.focusable = true
  historyBox.add(historySelect)
  root.add(historyBox)

  // Right panel — content/diff
  const contentBox = new BoxRenderable(renderer, {
    id: "content-panel",
    flexGrow: 1,
    height: renderer.terminalHeight - 1,
    border: true,
    borderStyle: "single",
    borderColor: "#888888",
    flexDirection: "column",
  })
  const contentTitle = new TextRenderable(renderer, {
    id: "content-title",
    content: " Content ",
    height: 1,
  })
  contentBox.add(contentTitle)

  const contentScroll = new ScrollBoxRenderable(renderer, {
    id: "content-scroll",
    flexGrow: 1,
  })
  const contentText = new TextRenderable(renderer, {
    id: "content-text",
    content: initialContent || "(empty)",
  })
  contentScroll.add(contentText)
  contentBox.add(contentScroll)
  root.add(contentBox)

  // Status bar
  const statusBar = new TextRenderable(renderer, {
    id: "status-bar",
    content: "  [q]uit  [d]iff view  [j/k] navigate",
    height: 1,
    width: renderer.terminalWidth,
  })
  // We need a wrapper to place the status bar below the main content
  const outerRoot = new BoxRenderable(renderer, {
    id: "outer-root",
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    flexDirection: "column",
  })
  renderer.root.remove("root")
  root.height = renderer.terminalHeight - 1
  outerRoot.add(root)
  outerRoot.add(statusBar)
  renderer.root.add(outerRoot)

  // Helper: get content for a hash (cached)
  async function getContent(hash: string): Promise<string> {
    const cached = contentCache.get(hash)
    if (cached !== undefined) return cached
    const content = await fsInstance.getFileAt(filePath, [hash])
    contentCache.set(hash, content)
    return content
  }

  // Helper: update the right panel
  async function updateContentPanel() {
    const idx = historySelect.getSelectedIndex()
    const entry = history[idx]
    if (!entry) return

    if (diffMode && idx < history.length - 1) {
      contentTitle.content = " Diff "
      const prevEntry = history[idx + 1]!
      const [currentContent, prevContent] = await Promise.all([
        getContent(entry.hash),
        getContent(prevEntry.hash),
      ])
      const patch = createTwoFilesPatch(
        filePath,
        filePath,
        prevContent,
        currentContent,
        `#${history.length - idx - 1}`,
        `#${history.length - idx}`
      )
      contentText.content = patch || "(no changes)"
    } else if (diffMode) {
      contentTitle.content = " Diff "
      contentText.content = "(first version — no previous version to diff against)"
    } else {
      contentTitle.content = " Content "
      const content = await getContent(entry.hash)
      contentText.content = content || "(empty)"
    }
  }

  // Events
  historySelect.on("selectionChanged", () => {
    updateContentPanel()
  })

  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "q") {
      renderer.destroy()
      process.exit(0)
    }
    if (key.name === "d") {
      diffMode = !diffMode
      statusBar.content = diffMode
        ? "  [q]uit  [d]iff view (ON)  [j/k] navigate"
        : "  [q]uit  [d]iff view  [j/k] navigate"
      updateContentPanel()
    }
  })

  renderer.start()
  historySelect.focus()
}

// Effect program to load data and launch TUI
const program = Effect.gen(function* () {
  const fsInstance = yield* AutomergeFsInstance
  const history = yield* Effect.promise(() => fsInstance.getFileHistory(filePath))

  if (history.length === 0) {
    console.log("No history available for", filePath)
    process.exit(0)
  }

  // Newest first
  history.reverse()

  const initialContent = yield* Effect.promise(() =>
    fsInstance.getFileAt(filePath, [history[0]!.hash])
  )

  // Launch TUI (non-Effect, takes over the terminal)
  yield* Effect.promise(() => startTUI(fsInstance, history, initialContent))
})

const ConfigLayer = Layer.succeed(DaemonConfig, {
  socketPath: "",
  dataDir: ".data/agent-demo",
})

const main = program.pipe(
  Effect.catchAll((error) => {
    console.error("Error:", error)
    return Effect.void
  }),
  Effect.provide(DaemonLive),
  Effect.provide(ConfigLayer),
)

NodeRuntime.runMain(main)
