import * as fs from "fs";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const MCP_CONFIG_PATH = path.join(HOME, ".config", "luva", "mcp.json");

export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPConfig {
  servers: MCPServer[];
}

interface MCPConnection {
  process: ChildProcess;
  server: MCPServer;
  tools: MCPTool[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

// Active MCP connections
const connections: Map<string, MCPConnection> = new Map();

// Load MCP config
export function loadMCPConfig(): MCPConfig {
  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    return { servers: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"));
  } catch {
    return { servers: [] };
  }
}

// Save MCP config
export function saveMCPConfig(config: MCPConfig): void {
  const dir = path.dirname(MCP_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Add a new MCP server
export function addMCPServer(name: string, command: string, args: string[] = []): MCPServer {
  const config = loadMCPConfig();
  
  // Check if exists
  const existing = config.servers.find(s => s.name === name);
  if (existing) {
    throw new Error(`Server '${name}' already exists`);
  }

  const server: MCPServer = { name, command, args, enabled: true };
  config.servers.push(server);
  saveMCPConfig(config);
  
  return server;
}

// Remove MCP server
export function removeMCPServer(name: string): boolean {
  const config = loadMCPConfig();
  const idx = config.servers.findIndex(s => s.name === name);
  if (idx === -1) return false;
  
  config.servers.splice(idx, 1);
  saveMCPConfig(config);
  
  // Disconnect if connected
  disconnectServer(name);
  
  return true;
}

// Toggle server enabled/disabled
export function toggleMCPServer(name: string): boolean {
  const config = loadMCPConfig();
  const server = config.servers.find(s => s.name === name);
  if (!server) return false;
  
  server.enabled = !server.enabled;
  saveMCPConfig(config);
  
  if (!server.enabled) {
    disconnectServer(name);
  }
  
  return server.enabled;
}

// Connect to MCP server via stdio
export async function connectServer(server: MCPServer): Promise<MCPTool[]> {
  if (connections.has(server.name)) {
    return connections.get(server.name)!.tools;
  }

  return new Promise((resolve, reject) => {
    try {
      // Windows'ta shell: true gerekli (npx, npm gibi komutlar için)
      const isWindows = process.platform === "win32";
      const proc = spawn(server.command, server.args || [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...server.env },
        shell: isWindows  // Windows'ta shell kullan
      });

      let buffer = "";
      const tools: MCPTool[] = [];

      proc.stdout?.on("data", (data) => {
        buffer += data.toString();
        
        // Try to parse JSON-RPC messages
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.result?.tools) {
              for (const tool of msg.result.tools) {
                tools.push({
                  name: tool.name,
                  description: tool.description || "",
                  inputSchema: tool.inputSchema || {},
                  serverName: server.name
                });
              }
            }
          } catch {}
        }
      });

      proc.stderr?.on("data", (data) => {
        console.error(`[${server.name}] ${data.toString()}`);
      });

      proc.on("error", (err) => {
        reject(err);
      });

      proc.on("close", (code) => {
        connections.delete(server.name);
      });

      // Send initialize request
      const initMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "luva", version: "1.0.0" }
        }
      }) + "\n";
      
      proc.stdin?.write(initMsg);

      // Send tools/list request
      setTimeout(() => {
        const listMsg = JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {}
        }) + "\n";
        proc.stdin?.write(listMsg);
      }, 100);

      // Wait for tools
      setTimeout(() => {
        connections.set(server.name, { process: proc, server, tools });
        resolve(tools);
      }, 500);

    } catch (err) {
      reject(err);
    }
  });
}

// Disconnect from server
export function disconnectServer(name: string): void {
  const conn = connections.get(name);
  if (conn) {
    conn.process.kill();
    connections.delete(name);
  }
}

// Call MCP tool
export async function callMCPTool(serverName: string, toolName: string, args: any): Promise<any> {
  const conn = connections.get(serverName);
  if (!conn) {
    throw new Error(`Server '${serverName}' not connected`);
  }

  return new Promise((resolve, reject) => {
    const id = Date.now();
    let buffer = "";

    const handler = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            conn.process.stdout?.off("data", handler);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg.result);
            }
          }
        } catch {}
      }
    };

    conn.process.stdout?.on("data", handler);

    const callMsg = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args }
    }) + "\n";

    conn.process.stdin?.write(callMsg);

    // Timeout
    setTimeout(() => {
      conn.process.stdout?.off("data", handler);
      reject(new Error("MCP call timeout"));
    }, 30000);
  });
}

// Connect all enabled servers
export async function connectAllServers(): Promise<MCPTool[]> {
  const config = loadMCPConfig();
  const allTools: MCPTool[] = [];

  for (const server of config.servers) {
    if (!server.enabled) continue;
    try {
      const tools = await connectServer(server);
      allTools.push(...tools);
    } catch (err: any) {
      console.error(`❌ MCP ${server.name}: ${err.message}`);
    }
  }

  return allTools;
}

// Disconnect all servers
export function disconnectAllServers(): void {
  for (const name of connections.keys()) {
    disconnectServer(name);
  }
}

// List servers with status
export function listMCPServers(): string {
  const config = loadMCPConfig();
  
  if (config.servers.length === 0) {
    return `📡 MCP Servers: Yok

Eklemek için:
  mcp add <name> <command> [args...]
  
Örnek:
  mcp add filesystem npx -y @anthropic/mcp-filesystem
  mcp add github npx -y @anthropic/mcp-github`;
  }

  let output = "📡 MCP Servers:\n\n";
  
  for (const server of config.servers) {
    const connected = connections.has(server.name);
    const status = !server.enabled ? "⏸️" : connected ? "🟢" : "⚪";
    const toolCount = connected ? connections.get(server.name)!.tools.length : 0;
    
    output += `${status} ${server.name}\n`;
    output += `   ${server.command} ${(server.args || []).join(" ")}\n`;
    if (connected) {
      output += `   ${toolCount} tool aktif\n`;
    }
    output += "\n";
  }

  return output;
}

// Get all available MCP tools
export function getMCPTools(): MCPTool[] {
  const tools: MCPTool[] = [];
  for (const conn of connections.values()) {
    tools.push(...conn.tools);
  }
  return tools;
}

// Popular MCP servers for quick add
export const popularServers: Record<string, { command: string; args: string[]; description: string }> = {
  "filesystem": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    description: "Dosya sistemi erişimi"
  },
  "github": {
    command: "npx", 
    args: ["-y", "@modelcontextprotocol/server-github"],
    description: "GitHub API erişimi"
  },
  "postgres": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    description: "PostgreSQL veritabanı"
  },
  "sqlite": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    description: "SQLite veritabanı"
  },
  "puppeteer": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    description: "Web scraping & browser automation"
  },
  "brave-search": {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    description: "Brave Search API"
  }
};

// Quick add popular server
export function addPopularServer(name: string): MCPServer | null {
  const preset = popularServers[name];
  if (!preset) return null;
  
  return addMCPServer(name, preset.command, preset.args);
}

// List popular servers
export function listPopularServers(): string {
  let output = "📦 Popüler MCP Servers:\n\n";
  
  for (const [name, info] of Object.entries(popularServers)) {
    output += `  ${name.padEnd(15)} - ${info.description}\n`;
  }
  
  output += "\nKurmak için: mcp install <name>";
  return output;
}
