# Nodeterm MCP Server

A Model Context Protocol (MCP) server that allows AI agents (like Gemini CLI or Claude Desktop) to interact with **Nodeterm** connections and terminal data.

## Features

- **General Connection Management**: List and inspect all types of connections (SSH, RDP, SFTP, etc.) stored in Nodeterm.
- **Run SSH Commands**: Execute shell commands on remote servers using stored SSH credentials.
- **Local Terminal Info**: Access information about configured local terminals (WSL, Ubuntu, etc.).
- **Security**: Directly reads Nodeterm's local data storage (`app-data.json`) to leverage your existing configurations.

## Prerequisites

- [Nodeterm](https://nodeterm.com) installed and configured.
- [Node.js](https://nodejs.org) (v18 or higher) installed.

## Installation

### For Gemini CLI

Add the server to your Gemini CLI configuration:

```bash
gemini mcp add nodeterm-mcp npx -y @tu-usuario/nodeterm-mcp
```

Or manually add it to your `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "nodeterm-mcp": {
      "command": "npx",
      "args": ["-y", "@tu-usuario/nodeterm-mcp"],
      "trust": true
    }
  }
}
```

### For Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nodeterm-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/nodeterm-mcp/index.js"]
    }
  }
}
```

## Available Tools

### `list_connections`
Returns a list of all available connections from Nodeterm.
- `type` (optional): Filter by connection type (e.g., "ssh", "rdp", "sftp").

### `get_connection_details`
Retrieves the full configuration object for a specific connection.
- `connectionName`: The name or ID of the connection.

### `run_ssh_command`
Executes a shell command on a remote host via SSH.
- `connectionName`: The name or ID of the SSH connection.
- `command`: The command to execute (e.g., `uptime`, `ls -la`).

### `get_local_terminal_info`
Retrieves information about the configured local terminal environment in Nodeterm (default terminal, fonts, workspace layout).

## How it works

The server reads the Nodeterm configuration file located at `~/.nodeterm/app-data.json`. It aggregates data from:
1. `nodeterm_favorite_connections`
2. `nodeterm_connection_history`
3. Global UI and Terminal settings.

## License

MIT
