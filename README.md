# Nodeterm MCP Server

A Model Context Protocol (MCP) server that enables AI agents to interact with **Nodeterm** connections. This allows your AI (in Cursor, Claude Desktop, Antigravity-CLI, etc.) to securely list your SSH connections and execute commands on remote servers by talking to NodeTerm's local API.

## 🔒 Security & Architecture

Unlike the previous version, **nodeterm-mcp v1.1.0+ does not read cleartext files from disk nor store credentials**. It acts as a secure *thin client* communicating with NodeTerm's built-in local HTTP API.

To operate, the following conditions must be met:
1. **NodeTerm must be running** on your local machine.
2. **Passwords must be unlocked** in NodeTerm (Master Key entered).
3. **MCP Integration must be enabled** in NodeTerm settings.
4. The client must authenticate using a secure **API Key**.

---

## 🚀 Quick Start

### 1. Enable MCP in NodeTerm
1. Open NodeTerm and go to **Settings (Configuración) > Integraciones > MCP**.
2. Toggle **Habilitar servidor MCP** (Enable MCP server).
3. This will generate a secure **API Key** and show the port (default: `19800`).

### 2. Configure your MCP Client
Copy your **API Key** from NodeTerm and set the following environment variables in your MCP client config:

- `NODETERM_API_KEY`: The API Key copied from NodeTerm settings.
- `NODETERM_PORT`: (Optional) The port NodeTerm's API is listening on (default: `19800`).

#### Example for Cursor / Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nodeterm": {
      "command": "npx",
      "args": ["-y", "@kalidus/nodeterm-mcp"],
      "env": {
        "NODETERM_API_KEY": "YOUR_NODETERM_API_KEY",
        "NODETERM_PORT": "19800"
      }
    }
  }
}
```

#### Example for OpenCode (`opencode.json`):
```json
{
  "mcp": {
    "nodeterm-mcp": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "@kalidus/nodeterm-mcp"
      ],
      "env": {
        "NODETERM_API_KEY": "YOUR_NODETERM_API_KEY",
        "NODETERM_PORT": "19800"
      },
      "enabled": true
    }
  }
}
```

---

## 🧰 Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_connections` | Lists all connections available in Nodeterm (SSH, RDP, SFTP, etc.) excluding credentials. | `type` (optional: 'ssh', 'rdp', etc.) |
| `get_connection_details` | Retrieves connection metadata for a specific connection (excluding passwords/keys). | `connectionName` (name or ID) |
| `run_ssh_command` | Executes a command on a remote host using an existing Nodeterm SSH connection. NodeTerm manages the credentials and execution. | `connectionName`, `command` |

---

## 💻 Local Development

If you want to run the server from source:

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run using node, providing the environment variables:
   ```bash
   NODETERM_API_KEY="your-key" NODETERM_PORT="19800" node index.js
   ```

## License
MIT
