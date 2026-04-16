# Nodeterm SSH MCP Server

A Model Context Protocol (MCP) server that allows AI agents (like Gemini CLI or Claude Desktop) to interact with your existing SSH connections stored in **Nodeterm**.

## Features

- **List Connections**: Retrieve all SSH connections configured in Nodeterm (Favorites and History).
- **Run Commands**: Execute shell commands on remote servers using stored credentials.
- **Security**: Leverages Nodeterm's local data storage for credentials.

## Prerequisites

- [Nodeterm](https://nodeterm.com) installed and configured with SSH connections.
- [Node.js](https://nodejs.org) (v18 or higher) installed.

## Installation

### For Gemini CLI

Add the server to your Gemini CLI configuration:

```bash
gemini mcp add nodeterm-ssh-mcp npx -y @tu-usuario/nodeterm-ssh-mcp
```

Or manually add it to your `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "nodeterm-ssh-mcp": {
      "command": "npx",
      "args": ["-y", "@tu-usuario/nodeterm-ssh-mcp"],
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
    "nodeterm-ssh": {
      "command": "node",
      "args": ["/absolute/path/to/nodeterm-ssh-mcp/index.js"]
    }
  }
}
```

## Tools

### `list_ssh_connections`
Returns a list of all available SSH connections from Nodeterm, including their names, hosts, and usernames.

### `run_ssh_command`
Executes a command on a specific connection.
- `connectionName`: The name or ID of the connection (e.g., "Production-DB").
- `command`: The shell command to run (e.g., "uptime").

## How it works

The server reads the Nodeterm configuration file located at `~/.nodeterm/app-data.json`. It looks for:
1. `nodeterm_favorite_connections`
2. `nodeterm_connection_history`

It then filters for SSH-type connections and provides them to the AI agent.

## License

MIT
