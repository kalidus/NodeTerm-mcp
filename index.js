#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import os from "os";
import { Client } from "ssh2";

// Constants
const NODETERM_DATA_PATH = path.join(os.homedir(), ".nodeterm", "app-data.json");

/**
 * MCP Server Implementation
 */
const server = new Server(
  {
    name: "nodeterm-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Loads and filters connections from Nodeterm data file.
 * @returns {Array} List of unique connections
 */
function getConnections() {
  try {
    if (!fs.existsSync(NODETERM_DATA_PATH)) {
      console.error(`Nodeterm data file not found at: ${NODETERM_DATA_PATH}`);
      return [];
    }

    const data = JSON.parse(fs.readFileSync(NODETERM_DATA_PATH, "utf8"));
    const favorites = JSON.parse(data.nodeterm_favorite_connections || "[]");
    const history = JSON.parse(data.nodeterm_connection_history || "[]");
    
    // Combine and remove duplicates by ID
    const connections = [...favorites, ...history];
    const uniqueConnections = [];
    const seenIds = new Set();
    
    for (const conn of connections) {
      if (!seenIds.has(conn.id)) {
        uniqueConnections.push(conn);
        seenIds.add(conn.id);
      }
    }
    
    return uniqueConnections;
  } catch (error) {
    console.error("Error reading Nodeterm data:", error.message);
    return [];
  }
}

/**
 * Gets local terminal configuration.
 */
function getLocalTerminalInfo() {
  try {
    if (!fs.existsSync(NODETERM_DATA_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(NODETERM_DATA_PATH, "utf8"));
    return {
      defaultTerminal: data.nodeterm_default_local_terminal,
      workspace: JSON.parse(data.homeTab_localTerminalWorkspace || "{}"),
      fontFamily: data.basicapp_local_terminal_font_family,
      fontSize: data.basicapp_local_terminal_font_size
    };
  } catch (error) {
    return null;
  }
}

/**
 * Executes a command on a remote host via SSH.
 */
async function executeSSH(host, port, username, password, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = "";
    let errorOutput = "";

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);
        stream.on("close", (code, signal) => {
          conn.end();
          resolve({ output, errorOutput, code });
        }).on("data", (data) => {
          output += data.toString();
        }).stderr.on("data", (data) => {
          errorOutput += data.toString();
        });
      });
    }).on("error", (err) => {
      reject(err);
    }).connect({
      host,
      port: parseInt(port) || 22,
      username,
      password,
      readyTimeout: 10000,
    });
  });
}

/**
 * Tool Definitions
 */
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
        description: "Retrieves full details for a specific connection in Nodeterm.",
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
        name: "get_local_terminal_info",
        description: "Retrieves information about the local terminal configuration in Nodeterm.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

/**
 * Tool Execution Handler
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_connections") {
    const { type } = args || {};
    let connections = getConnections();
    
    if (type) {
      connections = connections.filter(c => c.type === type);
    }

    const list = connections.map(c => ({
      name: c.name,
      type: c.type,
      host: c.host,
      user: c.username,
      id: c.id
    }));
    
    return {
      content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
    };
  }

  if (name === "get_connection_details") {
    const { connectionName } = args;
    const connections = getConnections();
    
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
    const connections = getConnections();
    
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

    try {
      const result = await executeSSH(conn.host, conn.port, conn.username, conn.password, command);
      return {
        content: [
          {
            type: "text",
            text: `Output:\n${result.output}${result.errorOutput ? "\nErrors:\n" + result.errorOutput : ""}\nExit Code: ${result.code}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `SSH Execution failed: ${error.message}` }],
      };
    }
  }

  if (name === "get_local_terminal_info") {
    const info = getLocalTerminalInfo();
    if (!info) {
      return {
        isError: true,
        content: [{ type: "text", text: "Could not retrieve local terminal info." }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

/**
 * Main Entry Point
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nodeterm MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
