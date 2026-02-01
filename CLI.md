# CLI Usage Guide

## Quick Start

```bash
# Install globally (requires Bun)
bun install -g automerge-fs

# Start the daemon (runs in foreground)
automerge-fsd start

# In another terminal, use the CLI
amfs bash "echo 'hello' > /home/user/test.txt"
amfs read /home/user/test.txt
amfs history
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Claude Code                                        │
│                                                                             │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐                │
│   │  Read   │    │  Write  │    │  Edit   │    │  Bash   │                │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘                │
│        │              │              │              │                       │
└────────┼──────────────┼──────────────┼──────────────┼───────────────────────┘
         │              │              │              │
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
                                │
                                │ Unix Socket
                                │ Cap'n Web RPC
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          automerge-fsd                                     │
│                    (Bun daemon + Cap'n Web)                                │
│                                                                           │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  │
│  │ Automerge   │   │   just-bash │   │  Cap'n Web  │   │   Blob      │  │
│  │ Repo        │   │   Engine    │   │  RpcTarget  │   │   Store     │  │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘  │
│                                                                           │
│  State kept in memory ─── Fast response times (~1-5ms per request)       │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  ┌─────────────┐       ┌─────────────┐       ┌─────────────┐
  │  Root Doc   │       │  File Docs  │       │   Blobs     │
  │  (dir tree) │       │  (per-file) │       │  (binaries) │
  └─────────────┘       └─────────────┘       └─────────────┘
         │                      │                      │
         └──────────────────────┴──────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │  ~/.automerge-fs/     │
                    │    automerge/         │  (Automerge docs)
                    │    blobs/             │  (Content-addressed)
                    └───────────────────────┘
```

## Why Bun + Cap'n Web?

**Bun advantages:**
- ~100ms cold start vs ~500ms for Node.js
- Native Unix socket support
- Native TypeScript execution (no transpilation)
- Single binary distribution

**Cap'n Web advantages:**
- Schemaless RPC (just define TypeScript interfaces)
- Object-capability model (pass objects by reference)
- Promise pipelining (batch multiple calls in one round trip)
- Zero-copy JSON serialization
- <10KB minified+gzipped

## Daemon Commands

### Start the daemon

```bash
# Run in foreground (recommended for development)
bun run src/daemon.ts start [options]

# Or if installed globally
automerge-fsd start [options]

Options:
  --socket PATH    Unix socket path (default: /tmp/amfs.sock)
  --data PATH      Data directory (default: ~/.automerge-fs)
```

### Check status

```bash
amfs status

# Output:
# {"ok":true,"pid":12345,"runtime":"bun","version":"1.1.0","uptime":3600,
#  "dataDir":"/home/user/.automerge-fs","documents":42,"blobs":7,
#  "memory":{"heapUsed":45,"heapTotal":67,"rss":89}}
```

### Stop the daemon

```bash
amfs shutdown
# Or just Ctrl+C in the terminal running the daemon
```

## CLI Commands

### File Operations

```bash
# Read a file
amfs read /home/user/file.txt

# Write a file (content as argument)
amfs write /home/user/file.txt "Hello, World!"

# Write a file (content from stdin)
echo "Hello, World!" | amfs write /home/user/file.txt

# Pipe content
cat local-file.txt | amfs write /home/user/remote.txt

# Get file stats
amfs stat /home/user/file.txt
# {"ok":true,"size":13,"isFile":true,"isDirectory":false,...}

# List directory
amfs ls /home/user
# {"ok":true,"entries":[{"name":"file.txt","isFile":true,...}]}

# Create directory
amfs mkdir /home/user/newdir
amfs mkdir -p /home/user/deep/nested/path

# Remove file
amfs rm /home/user/file.txt
```

### Bash Execution

```bash
# Run a command (output goes to stdout/stderr)
amfs bash "ls -la /home/user"

# Complex commands
amfs bash "find /home -name '*.ts' | xargs grep 'TODO'"

# Exit code is preserved
amfs bash "false"
echo $?  # 1
```

### Version Control

```bash
# Create a snapshot before risky changes
amfs snapshot "before-refactor"
# {"ok":true,"heads":["abc123..."],"name":"before-refactor"}

# View operation history
amfs history
# {"ok":true,"operationLog":[
#   {"timestamp":1706745600000,"operation":"writeFile","path":"/home/user/file.txt"},
#   {"timestamp":1706745601000,"operation":"mkdir","path":"/home/user/newdir"},
#   ...
# ]}

# View specific file's history
amfs history /home/user/file.txt
# {"ok":true,"fileHistory":[
#   {"timestamp":1706745600000,"type":"write","bytesDelta":100},
#   {"timestamp":1706745700000,"type":"append","bytesDelta":50},
# ]}
```

## Setting Up Claude Code Hooks

### 1. Create hook directory in your project

```bash
mkdir -p .claude/hooks
```

### 2. Copy the hook script

```bash
# Python version (recommended)
cp /path/to/automerge-fs/hooks/amfs-hook.py .claude/hooks/
chmod +x .claude/hooks/amfs-hook.py

# Or bash version
cp /path/to/automerge-fs/hooks/amfs-hook.sh .claude/hooks/
chmod +x .claude/hooks/amfs-hook.sh
```

### 3. Configure Claude Code

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Write|Edit|Bash",
        "hooks": [".claude/hooks/amfs-hook.py"]
      }
    ]
  }
}
```

### 4. Start the daemon

```bash
automerge-fsd start
```

### 5. Use Claude Code normally

All file operations will now be versioned!

## Auto-Starting the Daemon

### macOS (launchd)

```bash
# Edit the plist to use bun
cp service/com.automerge-fs.daemon.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.automerge-fs.daemon.plist
```

### Linux (systemd user service)

```bash
mkdir -p ~/.config/systemd/user
cp service/automerge-fsd.service ~/.config/systemd/user/
systemctl --user enable automerge-fsd
systemctl --user start automerge-fsd
```

## Performance Considerations

### Bun + Cap'n Web vs Node.js

| Approach | Cold Start | Per-Request |
|----------|------------|-------------|
| Node.js (spawn per request) | ~500ms | ~500ms |
| Bun daemon (Cap'n Web) | ~100ms (once) | ~1-5ms |

Bun's faster startup + Cap'n Web's efficient RPC gives ~100x speedup for typical usage.

### Cap'n Web Features Used

- **Object-capability model**: The `AmfsService` class extends `RpcTarget`, making methods callable over RPC
- **Promise pipelining**: Multiple operations can be batched in a single round trip
- **Schemaless**: Just define TypeScript interfaces, no separate schema files

## Troubleshooting

### Daemon won't start

```bash
# Check if socket file exists from crashed daemon
ls -la /tmp/automerge-fs.sock

# Remove stale socket
rm /tmp/automerge-fs.sock

# Try starting again
automerge-fsd start
```

### Permission denied on socket

```bash
# Check socket permissions
ls -la /tmp/automerge-fs.sock

# Should be owned by your user
# If not, remove and restart daemon
```

### Hook not intercepting

```bash
# Test hook directly
echo '{"tool_name":"Read","tool_input":{"file_path":"/home/user/test.txt"}}' | python .claude/hooks/amfs-hook.py

# Check daemon is running
amfs status
```
