#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env.NODETERM_API_KEY;
const PORT = process.env.NODETERM_PORT || "19800";
const BASE_URL = `http://127.0.0.1:${PORT}`;

if (!API_KEY) {
  console.error("Error: NODETERM_API_KEY environment variable is required.");
  process.exit(1);
}

const server = new Server(
  {
    name: "nodeterm-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
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
    throw new Error(`Failed to communicate with NodeTerm: ${error.message}`);
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_connections",
        description: "Lists all connections available in Nodeterm (SSH, RDP, SFTP, etc.).",
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
        description: "Retrieves details for a specific connection in Nodeterm (excluding credentials).",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the connection.",
            },
          },
          required: ["connectionName"],
        },
      },
      {
        name: "run_ssh_command",
        description: "Executes a command on a remote host using an existing Nodeterm SSH connection.",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the SSH connection.",
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
        name: "list_sections",
        description: "Lists all sections/folders/groups available in NodeTerm (connections groups and document/note folders).",
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
        description: "Lists all configured connection sessions (SSH, RDP, SFTP, etc.) with group paths.",
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
        description: "Lists all password/credential manager entries securely.",
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_connections") {
      const { type } = args || {};
      const data = await apiRequest("/api/connections");
      let connections = data.connections || [];
      
      if (type) {
        connections = connections.filter(c => c.type === type);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(connections, null, 2) }],
      };
    }

    if (name === "get_connection_details") {
      const { connectionName } = args;
      const data = await apiRequest("/api/connections");
      const connections = data.connections || [];
      
      const conn = connections.find(c => 
        c.name === connectionName || 
        c.id === connectionName || 
        (c.name && c.name.toLowerCase() === connectionName.toLowerCase())
      );

      if (!conn) {
        return {
          isError: true,
          content: [{ type: "text", text: `Connection '${connectionName}' not found in Nodeterm.` }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(conn, null, 2) }],
      };
    }

    if (name === "run_ssh_command") {
      const { connectionName, command } = args;
      const data = await apiRequest("/api/connections");
      const connections = data.connections || [];
      
      const conn = connections.find(c => 
        (c.name === connectionName || c.id === connectionName || (c.name && c.name.toLowerCase() === connectionName.toLowerCase())) &&
        c.type === "ssh"
      );

      if (!conn) {
        return {
          isError: true,
          content: [{ type: "text", text: `SSH Connection '${connectionName}' not found in Nodeterm.` }],
        };
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

    if (name === "list_sections") {
      const { type } = args || {};
      let sections = [];

      if (!type || type === "connections") {
        const connData = await apiRequest("/api/connections");
        const connFolders = (connData.connections || [])
          .filter(c => c.isFolder)
          .map(c => ({ id: c.id, name: c.name, type: "connections", group: c.group }));
        sections = sections.concat(connFolders);
      }

      if (!type || type === "documents") {
        const docData = await apiRequest("/api/documents");
        const docFolders = (docData.documents || [])
          .filter(d => d.isFolder)
          .map(d => ({ id: d.id, name: d.name, type: "documents", path: d.path }));
        sections = sections.concat(docFolders);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(sections, null, 2) }],
      };
    }

    if (name === "list_sessions") {
      const { type } = args || {};
      const data = await apiRequest("/api/connections");
      let sessions = (data.connections || []).filter(c => !c.isFolder);

      if (type) {
        sessions = sessions.filter(s => s.type === type);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
      };
    }

    if (name === "list_passwords") {
      const { search } = args || {};
      const data = await apiRequest("/api/passwords");
      let passwords = (data.passwords || []).filter(p => !p.isFolder);

      if (search) {
        const lowerSearch = search.toLowerCase();
        passwords = passwords.filter(p => 
          (p.name && p.name.toLowerCase().includes(lowerSearch)) ||
          (p.username && p.username.toLowerCase().includes(lowerSearch)) ||
          (p.website && p.website.toLowerCase().includes(lowerSearch))
        );
      }

      return {
        content: [{ type: "text", text: JSON.stringify(passwords, null, 2) }],
      };
    }

    if (name === "list_notes") {
      const { search } = args || {};
      const data = await apiRequest("/api/documents");
      let notes = (data.documents || []).filter(d => !d.isFolder);

      if (search) {
        const lowerSearch = search.toLowerCase();
        notes = notes.filter(n => n.name && n.name.toLowerCase().includes(lowerSearch));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(notes, null, 2) }],
      };
    }
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nodeterm MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
