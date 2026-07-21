import fs from "fs";
import path from "path";
import os from "os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

function getApiKey() {
  if (process.env.NODETERM_API_KEY) {
    return process.env.NODETERM_API_KEY;
  }
  try {
    const configPath = path.join(os.homedir(), "AppData", "Roaming", "nodeterm", "mcp-config.json");
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (parsed.apiKey) return parsed.apiKey;
    }
  } catch (e) {
    // fallback
  }
  return "";
}

const API_KEY = getApiKey();

function discoverPort() {
  if (process.env.NODETERM_PORT) {
    return String(process.env.NODETERM_PORT);
  }
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "nodeterm", "mcp-server.json"));
  }
  candidates.push(path.join(os.homedir(), ".nodeterm", "mcp-server.json"));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const info = JSON.parse(fs.readFileSync(p, "utf8"));
        if (info && info.port) return String(info.port);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return "19800";
}

if (!API_KEY) {
  console.error("Error: NODETERM_API_KEY environment variable is required or must be present in AppData config.");
  process.exit(1);
}

function getBaseUrl() {
  const port = discoverPort();
  return { port, baseUrl: `http://127.0.0.1:${port}` };
}

const INTERACTIVE_PRIVILEGE_INSTRUCTIONS =
  "TERMINOLOGY (critical — do not confuse these): " +
  "(A) CONFIGURED / SAVED connections = entries in the NodeTerm sidebar tree (host, user, type). " +
  "Tools: list_connections, list_sessions, get_connection_details. " +
  "These are NOT open tabs; a configured connection may or may not have a tab open. " +
  "(B) OPEN terminals / OPEN sessions = tabs currently open in the NodeTerm UI right now " +
  "(status: connected/disconnected, focused, terminalId). " +
  "Tools: list_open_terminals (alias list_open_sessions). " +
  "Spanish cues: 'sesiones abiertas', 'pestanas abiertas', 'que hay abierto' => list_open_terminals. " +
  "'conexiones guardadas', 'sesiones configuradas', 'lista de conexiones' => list_connections or list_sessions. " +
  "NEVER answer 'what is open' with list_sessions or list_connections. " +
  "VISIBLE TERMINALS: Prefer open_terminal + run_terminal_command so the user sees every command. " +
  "SECRETS: list_passwords and list_connections return METADATA ONLY (never password values). " +
  "NEVER put passwords in chat, terminal_write, or run_terminal_command. " +
  "PRIVILEGE ESCALATION (sudo/su/passwords) required flow: " +
  "(1) run the privileged command in the visible tab (e.g. sudo su / git pull) WITHOUT the password, " +
  "(2) wait_terminal_pattern for a password prompt and READ promptTicket from the response, " +
  "(3) inject_secret with promptTicket + source=connection|keepass + id (NodeTerm types the secret; the agent never sees it), " +
  "(4) wait for root/privileged prompt, (5) continue with run_terminal_command. " +
  "inject_secret WITHOUT promptTicket always fails. " +
  "Fallback if inject_secret fails: unlock human input, let the USER type the password in the NodeTerm tab, then continue. " +
  "Do not use run_ssh_command for interactive password prompts; it is headless and invisible. " +
  "REQUIRES: NodeTerm desktop app running with MCP integration enabled.";

const server = new Server(
  {
    name: "nodeterm-mcp",
    version: "1.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: INTERACTIVE_PRIVILEGE_INSTRUCTIONS,
  }
);

async function apiRequest(endpoint, options = {}) {
  const { port, baseUrl } = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json",
    ...options.headers,
  };

  try {
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    const msg = String(error && error.message ? error.message : error);
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("Failed to fetch")
    ) {
      throw new Error(
        `NodeTerm is not running or MCP API is unreachable at 127.0.0.1:${port}. ` +
          `Start NodeTerm, unlock if needed, enable MCP integration, then retry.`
      );
    }
    throw new Error(`Failed to communicate with NodeTerm: ${msg}`);
  }
}

// In-memory connection cache
let connectionsCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60000; // 60 seconds TTL

async function getConnections(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && connectionsCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return connectionsCache;
  }
  const data = await apiRequest("/api/connections");
  connectionsCache = data.connections || [];
  lastCacheTime = now;
  return connectionsCache;
}

function textResult(payload) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_connections",
        description:
          "CONFIGURED/SAVED only: lists connection entries from the NodeTerm sidebar tree " +
          "(SSH, RDP, SFTP, folders, etc.). Does NOT mean those connections have an open tab. " +
          "For tabs open right now use list_open_terminals. " +
          "Use for: 'conexiones guardadas', 'lista de conexiones', 'sesiones configuradas'.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Optional filter by type (e.g. 'ssh', 'rdp', 'sftp').",
            },
          },
        },
      },
      {
        name: "get_connection_details",
        description:
          "CONFIGURED/SAVED only: details of one sidebar connection by name or id (no credentials). " +
          "Not an open-tab status check; use get_terminal_status or list_open_terminals for that.",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the saved connection.",
            },
          },
          required: ["connectionName"],
        },
      },
      {
        name: "run_ssh_command",
        description:
          "Headless SSH exec via NodeTerm pool on a CONFIGURED connection (NOT visible in a UI tab). " +
          "Prefer open_terminal + run_terminal_command for live OPEN tabs the user can see. " +
          "Does not open a tab and does not list open sessions.",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the saved SSH connection.",
            },
            command: {
              type: "string",
              description: "The shell command to execute.",
            },
          },
          required: ["connectionName", "command"],
        },
      },
      {
        name: "list_open_terminals",
        description:
          "OPEN tabs only: lists terminals currently open in the NodeTerm UI right now " +
          "(SSH and local PTYs), with terminalId, status, focused, etc. " +
          "THIS is the tool for 'sesiones abiertas', 'pestanas abiertas', 'que hay abierto', " +
          "'active sessions', 'open terminals'. " +
          "Do NOT use list_sessions or list_connections for that — those only list CONFIGURED/SAVED sidebar entries. " +
          "Requires NodeTerm running with MCP API up.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "list_open_sessions",
        description:
          "Alias of list_open_terminals. OPEN UI tabs only (not CONFIGURED sidebar entries). " +
          "Preferred name when the user says 'sesiones abiertas' / 'open sessions'. " +
          "Never confuse with list_sessions (saved configs).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "open_terminal",
        description:
          "Opens a new visible terminal TAB in NodeTerm from a CONFIGURED SSH connection " +
          "(connectionId/name) or a local PTY (localType: powershell, wsl, cygwin, ubuntu, etc.). " +
          "After opening, the tab appears in list_open_terminals. Prefer this over headless run_ssh_command " +
          "when the user should see or interact (e.g. sudo password).",
        inputSchema: {
          type: "object",
          properties: {
            connectionId: {
              type: "string",
              description: "CONFIGURED/saved connection id or name for SSH.",
            },
            localType: {
              type: "string",
              description: "Local terminal type: powershell, wsl, cygwin, ubuntu, linux-terminal, claude, etc.",
            },
            distroName: {
              type: "string",
              description: "Optional WSL distro name when opening a distro terminal.",
            },
            focus: {
              type: "boolean",
              description: "Focus the new tab (default true).",
            },
          },
        },
      },
      {
        name: "focus_terminal",
        description:
          "Focuses an OPEN terminal tab by terminalId (from list_open_terminals). Not a saved-connection id.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id (tab key from list_open_terminals), not connectionId.",
            },
          },
          required: ["terminalId"],
        },
      },
      {
        name: "lock_terminal_input",
        description:
          "Locks or unlocks human keyboard input on an OPEN terminal tab. Agent tools auto-lock while running; user can also toggle from the tab lock icon. " +
          "Before sudo/su password prompts, unlock (locked=false) so the user can type the password in the visible NodeTerm tab. Do not collect passwords in chat.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
            locked: { type: "boolean", description: "true to lock human input, false to unlock." },
          },
          required: ["terminalId", "locked"],
        },
      },
      {
        name: "run_terminal_command",
        description:
          "Runs a command in an OPEN visible NodeTerm tab (terminalId from list_open_terminals) with human-like typing. " +
          "Locks keyboard while running, unlocks after (unless keepLocked). Returns stdout and exitCode. " +
          "Requires an OPEN tab — not a configured connection id. " +
          "If sudo/su/password is needed: do NOT put passwords here. Prefer wait_terminal_pattern then inject_secret. " +
          "Fallback: unlock input and let the USER type the password in the NodeTerm tab.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
            command: { type: "string" },
            timeoutMs: { type: "number", description: "Default 120000." },
            humanTyping: { type: "boolean", description: "Default true." },
            keepLocked: { type: "boolean", description: "Keep human input locked after finish." },
          },
          required: ["terminalId", "command"],
        },
      },
      {
        name: "terminal_write",
        description:
          "Low-level write to an OPEN terminal tab (raw data and/or keys like ctrl+c, enter). Visible in the tab. Needs terminalId from list_open_terminals. " +
          "NEVER use this to send passwords; use inject_secret for password prompts.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
            data: { type: "string", description: "Raw text to send." },
            keys: {
              type: "array",
              items: { type: "string" },
              description: "Special keys: enter, ctrl+c, tab, escape, up, down, etc.",
            },
            humanTyping: { type: "boolean", description: "Default false (instant)." },
            keepLocked: { type: "boolean" },
          },
          required: ["terminalId"],
        },
      },
      {
        name: "read_terminal_buffer",
        description:
          "Reads the live output ring buffer of an OPEN terminal tab (terminalId from list_open_terminals). " +
          "Limit priority: if both maxLines>0 and maxChars>0 use maxLines; " +
          "if only one is >0 use that; if neither (or both 0) default maxLines=100. " +
          "0/null means not provided.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
            maxChars: {
              type: "number",
              description: "Last N characters. Ignored if maxLines>0 is also set. 0 = not provided.",
            },
            maxLines: {
              type: "number",
              description: "Last N lines (split by newline). Wins over maxChars when both >0. Default 100 if neither set. 0 = not provided.",
            },
            fromOffset: { type: "number" },
          },
          required: ["terminalId"],
        },
      },
      {
        name: "wait_terminal_pattern",
        description:
          "Waits until a pattern appears in an OPEN terminal buffer (prompts, shell ready, etc.). " +
          "After a password prompt match following an agent command (sudo/git/mysql/...), the response may include promptTicket " +
          "(opaque one-time token, TTL 60s) required by inject_secret. " +
          "Also useful to wait for root prompt (e.g. 'root@'). Do not wait for or capture password text itself.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
            pattern: { type: "string" },
            regex: { type: "boolean" },
            timeoutMs: { type: "number" },
            keepLocked: { type: "boolean" },
          },
          required: ["terminalId", "pattern"],
        },
      },
      {
        name: "get_terminal_status",
        description:
          "Status of an OPEN terminal tab (lock, busy, focus, buffer offset). Needs terminalId from list_open_terminals, not a saved connection id.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals (not connectionId).",
            },
          },
          required: ["terminalId"],
        },
      },
      {
        name: "list_sections",
        description:
          "Lists CONFIGURED sidebar folders/groups (connection groups and document folders). Not open tabs.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["connections", "documents"],
              description: "Optional filter for section type ('connections' or 'documents').",
            },
          },
        },
      },
      {
        name: "list_sessions",
        description:
          "CONFIGURED/SAVED only (alias-style of list_connections without folders): sidebar connection entries " +
          "(SSH, RDP, SFTP, etc.). Despite the name 'sessions', these are NOT open UI tabs. " +
          "For 'sesiones abiertas' / open tabs use list_open_terminals (or alias list_open_sessions). " +
          "Use list_sessions only for saved/configured connection inventory.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Optional filter by connection type (e.g. 'ssh', 'rdp', 'sftp').",
            },
          },
        },
      },
      {
        name: "list_passwords",
        description:
          "Lists password/credential manager entries as METADATA ONLY (id, name, type, path, username, website). " +
          "Never returns password, notes, api_key, wallet_seed, or other secrets. Use inject_secret to type a secret into a password prompt.",
        inputSchema: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "Optional search term to filter credentials by name, username or website.",
            },
          },
        },
      },
      {
        name: "inject_secret",
        description:
          "Injects a saved secret into an OPEN terminal password prompt by opaque reference. " +
          "The secret value NEVER appears in the tool response or agent context. " +
          "REQUIRES promptTicket from a prior wait_terminal_pattern that matched a password prompt " +
          "(after an allowlisted agent command such as sudo/git/mysql). Ticket is one-time, TTL 60s. " +
          "Flow: run command -> wait_terminal_pattern (read promptTicket) -> inject_secret(promptTicket,...) -> wait privileged prompt. " +
          "source=connection uses SSH connection password/passphrase; source=keepass uses password-manager password field. " +
          "Do NOT pass plaintext passwords here.",
        inputSchema: {
          type: "object",
          properties: {
            terminalId: {
              type: "string",
              description: "OPEN terminal id from list_open_terminals.",
            },
            source: {
              type: "string",
              enum: ["connection", "keepass"],
              description: "Where to resolve the secret from.",
            },
            promptTicket: {
              type: "string",
              description: "One-time ticket from wait_terminal_pattern (required).",
            },
            id: {
              type: "string",
              description:
                "Connection id (optional if the open SSH tab already has connectionId) or KeePass/password-manager entry id (required for keepass).",
            },
            field: {
              type: "string",
              enum: ["password", "passphrase"],
              description: "connection: password (default) or passphrase. keepass: password only.",
            },
          },
          required: ["terminalId", "source", "promptTicket"],
        },
      },
      {
        name: "list_notes",
        description: "Lists all documents/notes stored in NodeTerm.",
        inputSchema: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "Optional search term to filter notes by title.",
            },
          },
        },
      },
      {
        name: "create_password",
        description: "Creates a new credential, password, crypto wallet, or API key in NodeTerm.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "The name/label for the credential entry." },
            type: {
              type: "string",
              enum: ["password", "crypto_wallet", "api_key", "secure_note", "password-folder"],
              description: "The type of the credential entry. Defaults to 'password'.",
            },
            parentId: { type: "string", description: "Optional folder/parent ID to place the entry in." },
            username: { type: "string", description: "The username." },
            password: { type: "string", description: "The password." },
            website: { type: "string", description: "The website URL." },
            notes: { type: "string", description: "Secure notes associated with the entry." },
            api_key: { type: "string", description: "The API key (if type is api_key)." },
            wallet_seed: { type: "string", description: "The crypto wallet seed/mnemonic (if type is crypto_wallet)." },
          },
          required: ["name"],
        },
      },
      {
        name: "edit_password",
        description: "Edits an existing credential, password, crypto wallet, or API key in NodeTerm.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The unique ID of the credential entry to edit." },
            name: { type: "string", description: "New name/label for the credential entry." },
            username: { type: "string", description: "New username." },
            password: { type: "string", description: "New password." },
            website: { type: "string", description: "New website URL." },
            notes: { type: "string", description: "New secure notes." },
            api_key: { type: "string", description: "New API key." },
            wallet_seed: { type: "string", description: "New crypto wallet seed." },
          },
          required: ["id"],
        },
      },
      {
        name: "create_note",
        description: "Creates a new document or note (or folder) in NodeTerm.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "The title of the note or folder." },
            content: { type: "string", description: "The body/content of the note (supports markdown/HTML)." },
            type: {
              type: "string",
              enum: ["document", "document-folder"],
              description: "The type of entry. Defaults to 'document'.",
            },
            parentId: { type: "string", description: "Optional folder/parent ID to place the note in." },
          },
          required: ["name"],
        },
      },
      {
        name: "edit_note",
        description: "Edits an existing document or note title/content in NodeTerm.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The unique ID of the note to edit." },
            name: { type: "string", description: "New title for the note." },
            content: { type: "string", description: "New content/body for the note (supports markdown/HTML)." },
          },
          required: ["id"],
        },
      },
      {
        name: "list_recordings",
        description:
          "Lists session recordings stored by NodeTerm (metadata only). There is no sequential session number; use recordingId (rec_*) and filters by host/username/sessionName/time.",
        inputSchema: {
          type: "object",
          properties: {
            host: {
              type: "string",
              description: "Exact host filter (case-insensitive).",
            },
            username: {
              type: "string",
              description: "Exact username filter (case-insensitive).",
            },
            sessionName: {
              type: "string",
              description: "Substring filter on sessionName (case-insensitive).",
            },
            from: {
              type: "number",
              description: "Include recordings with createdAt/start >= this epoch ms.",
            },
            to: {
              type: "number",
              description: "Include recordings with createdAt/start <= this epoch ms.",
            },
          },
        },
      },
      {
        name: "get_recording",
        description:
          "Gets full metadata for one session recording by recordingId (rec_*). Does not return the asciicast body; use export_recording for content.",
        inputSchema: {
          type: "object",
          properties: {
            recordingId: {
              type: "string",
              description: "Recording id, e.g. rec_1704988800000_a3f8d9.",
            },
          },
          required: ["recordingId"],
        },
      },
      {
        name: "export_recording",
        description:
          "Exports the full asciicast (.cast) of a recording to a local file and returns the absolute path plus short metadata. The agent should Read/Grep that file in chunks (do not expect the cast body in this tool response). Default path: %APPDATA%/nodeterm/mcp-exports/{recordingId}.cast. Does not change recording configuration.",
        inputSchema: {
          type: "object",
          properties: {
            recordingId: {
              type: "string",
              description: "Recording id, e.g. rec_1704988800000_a3f8d9.",
            },
            exportPath: {
              type: "string",
              description:
                "Optional absolute path ending in .cast under mcp-exports or the recordings directory.",
            },
          },
          required: ["recordingId"],
        },
      },
      {
        name: "recording_stats",
        description:
          "Returns aggregate stats for NodeTerm session recordings (total count, duration, size, byHost, byUsername).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_connections") {
      const { type } = args || {};
      let connections = await getConnections();

      if (type) {
        connections = connections.filter((c) => c.type === type);
      }

      return textResult(connections);
    }

    if (name === "get_connection_details") {
      const { connectionName } = args;
      let connections = await getConnections();

      let conn = connections.find(
        (c) =>
          c.name === connectionName ||
          c.id === connectionName ||
          (c.name && c.name.toLowerCase() === connectionName.toLowerCase())
      );

      if (!conn) {
        connections = await getConnections(true);
        conn = connections.find(
          (c) =>
            c.name === connectionName ||
            c.id === connectionName ||
            (c.name && c.name.toLowerCase() === connectionName.toLowerCase())
        );
      }

      if (!conn) {
        return errorResult(`Connection '${connectionName}' not found in Nodeterm.`);
      }

      return textResult(conn);
    }

    if (name === "run_ssh_command") {
      const { connectionName, command } = args;
      let connections = await getConnections();

      let conn = connections.find(
        (c) =>
          (c.name === connectionName ||
            c.id === connectionName ||
            (c.name && c.name.toLowerCase() === connectionName.toLowerCase())) &&
          c.type === "ssh"
      );

      if (!conn) {
        connections = await getConnections(true);
        conn = connections.find(
          (c) =>
            (c.name === connectionName ||
              c.id === connectionName ||
              (c.name && c.name.toLowerCase() === connectionName.toLowerCase())) &&
            c.type === "ssh"
        );
      }

      if (!conn) {
        return errorResult(`SSH Connection '${connectionName}' not found in Nodeterm.`);
      }

      const result = await apiRequest("/api/ssh/exec", {
        method: "POST",
        body: JSON.stringify({
          connectionId: conn.id,
          command,
        }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Output:\n${result.stdout}${result.stderr ? "\nErrors:\n" + result.stderr : ""}\nExit Code: ${result.exitCode}`,
          },
        ],
      };
    }

    if (name === "list_open_terminals" || name === "list_open_sessions") {
      const data = await apiRequest("/api/terminals");
      const terminals = data.terminals || data || [];
      if (Array.isArray(terminals) && terminals.length === 0) {
        return textResult({
          terminals: [],
          message: "No open terminal tabs in NodeTerm right now.",
        });
      }
      return textResult({ terminals, count: Array.isArray(terminals) ? terminals.length : undefined });
    }

    if (name === "open_terminal") {
      const body = { ...(args || {}) };
      const connRef = body.connectionId || body.connectionName;
      if (connRef && !body.localType) {
        const data = await apiRequest("/api/connections");
        const connections = data.connections || [];
        const conn = connections.find(
          (c) =>
            !c.isFolder &&
            c.type === "ssh" &&
            (c.id === connRef ||
              c.name === connRef ||
              (c.name && c.name.toLowerCase() === String(connRef).toLowerCase()))
        );
        if (!conn) {
          return errorResult(`SSH connection '${connRef}' not found in Nodeterm.`);
        }
        body.connectionId = conn.id;
        delete body.connectionName;
      }
      const result = await apiRequest("/api/terminals/open", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return textResult(result);
    }

    if (name === "focus_terminal") {
      const result = await apiRequest("/api/terminals/focus", {
        method: "POST",
        body: JSON.stringify({ terminalId: args.terminalId }),
      });
      return textResult(result);
    }

    if (name === "lock_terminal_input") {
      const result = await apiRequest("/api/terminals/input-lock", {
        method: "POST",
        body: JSON.stringify({ terminalId: args.terminalId, locked: args.locked }),
      });
      return textResult(result);
    }

    if (name === "run_terminal_command") {
      const result = await apiRequest("/api/terminals/exec", {
        method: "POST",
        body: JSON.stringify({
          terminalId: args.terminalId,
          command: args.command,
          timeoutMs: args.timeoutMs,
          humanTyping: args.humanTyping,
          keepLocked: args.keepLocked,
        }),
      });
      return {
        content: [
          {
            type: "text",
            text: `Output:\n${result.stdout || ""}${result.stderr ? "\nErrors:\n" + result.stderr : ""}\nExit Code: ${result.exitCode}\nTimed Out: ${!!result.timedOut}\nTerminal: ${result.terminalId || args.terminalId}`,
          },
        ],
      };
    }

    if (name === "terminal_write") {
      const result = await apiRequest("/api/terminals/write", {
        method: "POST",
        body: JSON.stringify({
          terminalId: args.terminalId,
          data: args.data,
          keys: args.keys,
          humanTyping: args.humanTyping,
          keepLocked: args.keepLocked,
        }),
      });
      return textResult(result);
    }

    if (name === "inject_secret") {
      const { terminalId, source, id, field, promptTicket } = args || {};
      if (!terminalId || !source) {
        return errorResult("inject_secret requires terminalId and source");
      }
      if (promptTicket == null || String(promptTicket).length === 0) {
        return errorResult("inject_secret requires promptTicket from wait_terminal_pattern");
      }
      const result = await apiRequest("/api/terminals/inject-secret", {
        method: "POST",
        body: JSON.stringify({
          terminalId,
          source,
          promptTicket,
          id: id != null ? id : undefined,
          field: field != null ? field : undefined,
        }),
      });
      return textResult(result);
    }

    if (name === "read_terminal_buffer") {
      const result = await apiRequest("/api/terminals/buffer", {
        method: "POST",
        body: JSON.stringify({
          terminalId: args.terminalId,
          maxChars: args.maxChars,
          maxLines: args.maxLines,
          fromOffset: args.fromOffset,
        }),
      });
      return textResult(result);
    }

    if (name === "wait_terminal_pattern") {
      const result = await apiRequest("/api/terminals/wait", {
        method: "POST",
        body: JSON.stringify({
          terminalId: args.terminalId,
          pattern: args.pattern,
          regex: args.regex,
          timeoutMs: args.timeoutMs,
          keepLocked: args.keepLocked,
        }),
      });
      return textResult(result);
    }

    if (name === "get_terminal_status") {
      const result = await apiRequest("/api/terminals/status", {
        method: "POST",
        body: JSON.stringify({ terminalId: args.terminalId }),
      });
      return textResult(result);
    }

    if (name === "list_sections") {
      const { type } = args || {};
      let sections = [];

      if (!type || type === "connections") {
        const connections = await getConnections();
        const connFolders = connections
          .filter((c) => c.isFolder)
          .map((c) => ({ id: c.id, name: c.name, type: "connections", group: c.group }));
        sections = sections.concat(connFolders);
      }

      if (!type || type === "documents") {
        const docData = await apiRequest("/api/documents");
        const docFolders = (docData.documents || [])
          .filter((d) => d.isFolder)
          .map((d) => ({ id: d.id, name: d.name, type: "documents", path: d.path }));
        sections = sections.concat(docFolders);
      }

      return textResult(sections);
    }

    if (name === "list_sessions") {
      const { type } = args || {};
      const connections = await getConnections();
      let sessions = connections.filter((c) => !c.isFolder);

      if (type) {
        sessions = sessions.filter((s) => s.type === type);
      }

      return textResult(sessions);
    }

    if (name === "list_passwords") {
      const { search } = args || {};
      const data = await apiRequest("/api/passwords");
      let passwords = (data.passwords || []).filter((p) => !p.isFolder);

      if (search) {
        const lowerSearch = search.toLowerCase();
        passwords = passwords.filter(
          (p) =>
            (p.name && p.name.toLowerCase().includes(lowerSearch)) ||
            (p.username && p.username.toLowerCase().includes(lowerSearch)) ||
            (p.website && p.website.toLowerCase().includes(lowerSearch))
        );
      }

      return textResult(passwords);
    }

    if (name === "list_notes") {
      const { search } = args || {};
      const data = await apiRequest("/api/documents");
      let notes = (data.documents || []).filter((d) => !d.isFolder);

      if (search) {
        const lowerSearch = search.toLowerCase();
        notes = notes.filter((n) => n.name && n.name.toLowerCase().includes(lowerSearch));
      }

      return textResult(notes);
    }

    if (name === "create_password" || name === "edit_password") {
      const result = await apiRequest("/api/passwords", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return textResult(result);
    }

    if (name === "create_note" || name === "edit_note") {
      const result = await apiRequest("/api/documents", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return textResult(result);
    }

    if (name === "list_recordings") {
      const { host, username, sessionName, from, to } = args || {};
      const params = new URLSearchParams();
      if (host) params.set("host", host);
      if (username) params.set("username", username);
      if (sessionName) params.set("sessionName", sessionName);
      if (from != null && from !== "") params.set("from", String(from));
      if (to != null && to !== "") params.set("to", String(to));
      const qs = params.toString();
      const data = await apiRequest(`/api/recordings${qs ? `?${qs}` : ""}`);
      return textResult(data.recordings || []);
    }

    if (name === "get_recording") {
      const { recordingId } = args || {};
      if (!recordingId) {
        return errorResult("recordingId is required");
      }
      const data = await apiRequest(`/api/recordings/${encodeURIComponent(recordingId)}`);
      return textResult(data.metadata || data);
    }

    if (name === "export_recording") {
      const { recordingId, exportPath } = args || {};
      if (!recordingId) {
        return errorResult("recordingId is required");
      }
      const body = { recordingId };
      if (exportPath) body.exportPath = exportPath;
      const result = await apiRequest("/api/recordings/export", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return textResult(result);
    }

    if (name === "recording_stats") {
      const data = await apiRequest("/api/recordings/stats");
      return textResult(data.stats || data);
    }
  } catch (error) {
    return errorResult(error.message);
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const { port } = getBaseUrl();
  // Solo stderr: stdout es el protocolo MCP. No escribir nada mas al arrancar.
  console.error(`[nodeterm-mcp] ready stdio api=127.0.0.1:${port}`);
  // Mantener vivo el proceso aunque el event loop quede momentaneamente vacio
  if (process.stdin && typeof process.stdin.resume === "function") {
    process.stdin.resume();
  }
}

main().catch((error) => {
  const msg = error && error.stack ? error.stack : String(error);
  console.error(`[nodeterm-mcp] fatal: ${msg}`);
  process.exit(1);
});
