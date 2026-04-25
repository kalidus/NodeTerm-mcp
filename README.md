# Nodeterm MCP Server

A Model Context Protocol (MCP) server that enables AI agents to interact with **Nodeterm** connections and terminal data. This allows your AI to list your SSH connections and execute commands on remote servers using your existing Nodeterm configurations.

## 🚀 Quick Start

You can run this MCP server directly using `npx` without manual installation:

```bash
npx -y @kalidus/nodeterm-mcp
```

## 🛠️ Configuration by Platform

### 1. OpenCode
To use Nodeterm MCP in OpenCode, add it to your `opencode.json` configuration file (usually located in `~/.config/opencode/opencode.json` or through the UI settings):

```json
{
  "mcp": {
    "nodeterm-mcp": {
      "type": "local",
      "command": [
        "node",
        "/path/to/your/nodeterm-mcp/index.js"
      ],
      "enabled": true
    }
  }
}
```
*Note: If installed via npm, you can use `["npx", "-y", "@kalidus/nodeterm-mcp"]` as the command.*

### 2. Gemini CLI
Add the server using the CLI command:

```bash
gemini mcp add nodeterm-mcp npx -y @kalidus/nodeterm-mcp
```

### 3. Claude Code / Desktop
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nodeterm-mcp": {
      "command": "npx",
      "args": ["-y", "@kalidus/nodeterm-mcp"]
    }
  }
}
```

## 💻 Local Development

If you want to modify the code or use a local version:

1. Clone the repository.
2. Install dependencies: `npm install`.
3. Point your configuration to the absolute path of `index.js`.

Example for local development in OpenCode:
```json
"command": ["node", "C:/Users/tu-usuario/path/to/nodeterm-mcp/index.js"]
```

## 🧰 Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `mcp_list_connections` | Lists all connections available in Nodeterm. | `type` (optional: 'ssh', 'rdp', etc.) |
| `mcp_get_connection_details` | Retrieves full details for a specific connection. | `connectionName` |
| `mcp_run_ssh_command` | Executes a command on a remote host via SSH. | `connectionName`, `command` |
| `mcp_get_local_terminal_info` | Retrieves local terminal configuration. | - |

## 🔒 Security
The server reads Nodeterm's local data storage (`app-data.json`). It uses your existing saved credentials to establish SSH connections securely.

## License
MIT
