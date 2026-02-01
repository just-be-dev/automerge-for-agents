# automerge-for-agents

A versionable filesystem layer for AI agent tooling, built on [Automerge](https://automerge.org/) CRDTs. Provides full history tracking, time-travel, and rollback capabilities for every file operation an agent performs.

## Why?

When AI agents (like Claude Code) work on codebases, they make many file changes through tool calls. If something goes wrong, you typically have no way to understand what happened or roll back to a known-good state.

**automerge-fs** solves this by replacing the agent's filesystem with a CRDT-backed implementation that:

- **Tracks every edit** - Full history of all file operations
- **Enables time-travel** - Restore any file to any previous state
- **Supports branching** - Fork the filesystem for parallel exploration
- **Handles conflicts** - Automatic CRDT-based merge resolution
- **Provides diffs** - Compare any two states of the filesystem

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Claude Code                                        │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                 │
│   │  Read   │    │  Write  │    │  Edit   │    │  Bash   │                 │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘                 │
└────────┼──────────────┼──────────────┼──────────────┼───────────────────────┘
         └──────────────┴──────────────┴──────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │    PreToolUse Hook     │
                    │    (amfs-hook.py)      │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │      amfs CLI          │
                    │   (Bun + Cap'n Web)    │
                    └───────────┬────────────┘
                                │ Unix Socket RPC
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          automerge-fsd                                     │
│                    (Bun daemon + Cap'n Web)                                │
│                                                                           │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│  │ Automerge   │   │  just-bash  │   │  Cap'n Web  │   │    Blob     │   │
│  │    Repo     │   │   Engine    │   │  RpcTarget  │   │   Store     │   │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
  │  Root Doc   │       │  File Docs  │       │   Blobs     │
  │ (dir tree)  │       │ (per-file)  │       │ (binaries)  │
  └─────────────┘       └─────────────┘       └─────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| **automerge-fsd** | Long-running daemon holding Automerge state in memory |
| **amfs** | Thin CLI client for interacting with the daemon |
| **amfs-hook.py** | Claude Code hook that intercepts file operations |
| **AutomergeFsMultiDoc** | Multi-document filesystem implementation |
| **BlobStore** | Content-addressed storage for binary files |

### Multi-Document Design

The filesystem uses a three-tier architecture for efficiency:

1. **Root Document** - Directory tree with pointers to file documents
2. **File Documents** - One Automerge document per text file (independent history)
3. **Blob Store** - Content-addressed storage for binaries (no CRDT overhead)

This means editing `file-a.ts` doesn't pollute the history of `file-b.ts`, and binary files don't bloat the CRDT metadata.

## Quick Start

```bash
# Requires Bun (https://bun.sh)
bun install

# Start the daemon
bun run src/daemon.ts start

# In another terminal
amfs bash "echo 'hello world' > /tmp/test.txt"
amfs read /tmp/test.txt
amfs history /tmp/test.txt
amfs snapshot "checkpoint-1"
```

## CLI Commands

```bash
# File operations
amfs read <path>              # Read file (raw output for UTF-8)
amfs write <path> [content]   # Write file (stdin if no content)
amfs append <path> [content]  # Append to file
amfs stat <path>              # File info (size, mtime, etc.)
amfs ls [path]                # List directory
amfs mkdir [-p] <path>        # Create directory
amfs rm <path>                # Remove file
amfs mv <src> <dest>          # Move/rename
amfs cp <src> <dest>          # Copy

# Bash execution (runs in virtual filesystem)
amfs bash <command>

# Version control
amfs snapshot [name]          # Create named checkpoint
amfs history [path]           # Show operation history

# Service
amfs status                   # Daemon status
amfs shutdown                 # Stop daemon
```

## Claude Code Integration

Add a hook to intercept Claude's file operations:

**.claude/settings.json**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Read|Write|Edit|Bash",
      "hooks": [".claude/hooks/amfs-hook.py"]
    }]
  }
}
```

Copy the hook script:
```bash
cp hooks/amfs-hook.py .claude/hooks/
chmod +x .claude/hooks/amfs-hook.py
```

Now every file operation Claude makes is versioned.

## Technology Stack

| Tech | Role |
|------|------|
| [Automerge](https://automerge.org/) | CRDT library for conflict-free data structures |
| [just-bash](https://github.com/nicholasgriffintn/just-bash) | In-memory bash execution with virtual filesystem |
| [Cap'n Web](https://github.com/cloudflare/capnweb) | Schemaless RPC with promise pipelining |
| [Bun](https://bun.sh/) | Fast JavaScript runtime (~100ms cold start) |

### Why These Choices?

**Automerge** - CRDTs give us automatic conflict resolution, which matters for multi-agent scenarios or parallel exploration branches.

**Cap'n Web** - Cloudflare's schemaless RPC library means we just define TypeScript interfaces—no `.proto` files. Promise pipelining lets us batch operations.

**Bun** - ~100ms cold start vs ~500ms for Node.js. Native TypeScript execution. Native Unix socket support.

**Daemon architecture** - Pay initialization cost once, then ~1-5ms per RPC call. Essential when the hook fires on every file operation.

## Performance

| Metric | Value |
|--------|-------|
| Daemon cold start | ~100ms |
| Per-RPC latency | 1-5ms |
| Memory (base) | ~50MB |
| Memory (per file doc) | ~few KB |

## Use Cases

- **Agent debugging** - See exactly what changes an agent made
- **Checkpoint/rollback** - Save state before risky operations
- **Multi-agent collaboration** - CRDT merging handles concurrent edits
- **Audit trails** - Full history of every operation
- **Time-travel debugging** - Restore any file to any point in history

## File Structure

```
automerge-fs/
├── src/
│   ├── daemon.ts           # Bun daemon with Cap'n Web RPC
│   ├── cli.ts              # CLI client
│   ├── rpc-transport.ts    # Cap'n Web transport for Unix sockets
│   ├── automerge-fs-v2.ts  # Multi-document filesystem implementation
│   ├── blob-stores.ts      # Binary storage backends
│   └── examples-v2.ts      # Usage examples
├── hooks/
│   ├── amfs-hook.py        # Claude Code hook (Python)
│   └── amfs-hook.sh        # Claude Code hook (Bash)
├── service/
│   ├── automerge-fsd.service        # systemd unit
│   └── com.automerge-fs.daemon.plist # launchd plist
├── CLI.md                  # Detailed CLI documentation
├── ARCHITECTURE-V2.md      # Multi-document architecture details
└── CONSIDERATIONS.md       # Tradeoffs and alternatives
```

## Status

This is a design sketch / proof-of-concept. Key next steps:

- [ ] Implement rollback command
- [ ] Add garbage collection for orphaned documents
- [ ] Persistence via automerge-repo storage adapters
- [ ] Structured diff visualization
- [ ] Operation attribution (track which agent made each change)

## License

MIT
