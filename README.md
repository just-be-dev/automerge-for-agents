# automerge-for-agents

> [!NOTE]
> This is an early-stage experiment that I'm driving with claude code and is intended more as a proof-of-concept than a production-ready solution.

A versionable filesystem layer for AI agent tooling, built on [Automerge](https://automerge.org/) CRDTs. Provides full history tracking, time-travel, and rollback capabilities for every file operation an agent performs.

## Why?

I'm exploring being able to provide tools shaped like the default tools claude code is configured with, but without having to have an actual underlying filesystem. I want to be able to run these agent harnesses in environments like durable objects while still giving access to the Read/Write/Edit/Bash tools. 

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                            Agent                             │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│   │  Read   │    │  Write  │    │  Edit   │    │  Bash   │   │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘   │
└────────┼──────────────┼──────────────┼──────────────┼────────┘
         └──────────────┴──────────────┴──────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │      tools or mcp      │
                    └───────────┬────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          automerge-fsd                                   │
│                    (Bun daemon + Effect RPC)                             │
│                                                                          │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│  │ Automerge   │   │  just-bash  │   │ Effect RPC  │   │    Blob     │   │
│  │    Repo     │   │   Engine    │   │   Router    │   │    Store    │   │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
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

## License

MIT
