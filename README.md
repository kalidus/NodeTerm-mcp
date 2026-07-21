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
| `list_sections` | Lists all sections/folders/groups available in NodeTerm (connections groups and document/note folders). | `type` (optional: 'connections', 'documents') |
| `list_sessions` | Lists all configured connection sessions (SSH, RDP, SFTP, etc.) with group paths. | `type` (optional: 'ssh', 'rdp', etc.) |
| `list_passwords` | Lists password-manager entries as **metadata only** (id, name, type, path, username, website). Never returns secrets. | `search` (optional search filter) |
| `inject_secret` | Types a saved secret into an open terminal **password prompt** by opaque reference. Requires `promptTicket` from `wait_terminal_pattern`. Secret never appears in the tool response. | `terminalId`, `source` (`connection`\|`keepass`), `promptTicket` (required), `id` (required for keepass; optional for connection), `field` (optional) |
| `list_notes` | Lists all documents/notes stored in NodeTerm. | `search` (optional search filter) |
| `create_password` | Creates a new credential, password, crypto wallet, or API key in NodeTerm. | `name` (required), `type`, `parentId`, `username`, `password`, `website`, `notes`, `api_key`, `wallet_seed` |
| `edit_password` | Edits an existing credential, password, crypto wallet, or API key in NodeTerm. | `id` (required), `name`, `username`, `password`, `website`, `notes`, `api_key`, `wallet_seed` |
| `create_note` | Creates a new document or note (or folder) in NodeTerm. | `name` (required), `content`, `type`, `parentId` |
| `edit_note` | Edits an existing document or note title/content in NodeTerm. | `id` (required), `name`, `content` |

### Secure secret injection (v1.4.0+)

Required flow when `sudo` / `su` / `git` / `mysql -p` asks for a password:

1. Run the privileged command **without** the password (`run_terminal_command` or `terminal_write` + Enter).
2. `wait_terminal_pattern` for a password prompt; read `promptTicket` from the response (one-time, TTL 60s; only issued if the last agent command is allowlisted).
3. `inject_secret` with `promptTicket` + `source=connection|keepass` + entry/connection `id`.
4. Wait for the privileged shell prompt / pull result and continue.

Hardening: no ticket => inject fails; ticket is single-use; command correlation + rate limit (5/min/terminal). NodeTerm resolves the secret inside the app; the agent never sees it. Fallback: unlock human input and let the user type the password in the tab.

**Breaking changes:**
- `list_passwords` returns metadata only (no secret fields).
- `inject_secret` requires `promptTicket` from a prior `wait_terminal_pattern`.

---

## Local Development

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
