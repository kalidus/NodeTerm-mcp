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
    name: "nodeterm-ssh-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Loads and filters SSH connections from Nodeterm data file.
 * @returns {Array} List of unique SSH connections
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
    
    // Combine and remove duplicates by ID, ensuring they are SSH type
    const connections = [...favorites, ...history];
    const uniqueConnections = [];
    const seenIds = new Set();
    
    for (const conn of connections) {
      if (!seenIds.has(conn.id) && conn.type === "ssh") {
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
        name: "list_ssh_connections",
        description: "Lists all SSH connections available in Nodeterm.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_ssh_connection_password",
        description: "Retrieves the password for a specific SSH connection in Nodeterm.",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the connection in Nodeterm (e.g. 'Kepler').",
            },
          },
          required: ["connectionName"],
        },
      },
      {
        name: "run_ssh_command",
        description: "Executes a command on a remote host using an existing Nodeterm connection.",
        inputSchema: {
          type: "object",
          properties: {
            connectionName: {
              type: "string",
              description: "The name or ID of the connection in Nodeterm (e.g. 'Kepler').",
            },
            command: {
              type: "string",
              description: "The shell command to execute.",
            },
          },
          required: ["connectionName", "command"],
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

  if (name === "list_ssh_connections") {
    const connections = getConnections();
    const list = connections.map(c => ({
      name: c.name,
      host: c.host,
      user: c.username,
      port: c.port || 22,
      id: c.id
    }));
    
    return {
      content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
    };
  }

  if (name === "get_ssh_connection_password") {
    const { connectionName } = args;
    const connections = getConnections();
    
    // Find connection by Name or ID
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

    if (!conn.password) {
      return {
        content: [{ type: "text", text: `No password stored for connection '${connectionName}'.` }],
      };
    }

    return {
      content: [{ type: "text", text: conn.password }],
    };
  }

  if (name === "run_ssh_command") {
    const { connectionName, command } = args;
    const connections = getConnections();
    
    // Find connection by Name or ID
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

  throw new Error(`Tool not found: ${name}`);
});

/**
 * Main Entry Point
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Nodeterm SSH MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
