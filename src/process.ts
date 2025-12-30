/**
 * Background Process Manager - Kiro-style process control
 * 
 * Manages long-running processes like dev servers, watchers, etc.
 * Supports: start, stop, list, output viewing
 */

import { spawn, ChildProcess, execSync, exec } from "child_process";
import * as os from "os";

interface BackgroundProcess {
  id: number;
  command: string;
  cwd: string;
  process: ChildProcess;
  output: string[];
  status: "running" | "stopped" | "error";
  startTime: Date;
  pid?: number;
  port?: number;
}

// Global process registry
const processes: Map<number, BackgroundProcess> = new Map();
let nextProcessId = 1;

const MAX_OUTPUT_LINES = 500;
const isWindows = os.platform() === "win32";

/**
 * Open URL in default browser
 */
function openBrowser(url: string): void {
  const cmd = isWindows ? `start ${url}` : 
              os.platform() === "darwin" ? `open ${url}` : `xdg-open ${url}`;
  exec(cmd);
}

/**
 * Detect port from process output
 */
function detectPort(output: string): number | null {
  // Common patterns for port detection
  const patterns = [
    /localhost:(\d+)/i,
    /127\.0\.0\.1:(\d+)/i,
    /0\.0\.0\.0:(\d+)/i,
    /port\s*[:\s]\s*(\d+)/i,
    /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
    /:(\d{4,5})/,  // Any 4-5 digit port
  ];
  
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      const port = parseInt(match[1]);
      if (port >= 1000 && port <= 65535) {
        return port;
      }
    }
  }
  return null;
}

/**
 * Start a background process
 */
export function startProcess(command: string, cwd: string, autoOpenBrowser = true): { processId: number; isReused: boolean; message: string } {
  // Check if same command is already running in same directory
  for (const [id, proc] of processes) {
    if (proc.command === command && proc.cwd === cwd && proc.status === "running") {
      const portInfo = proc.port ? ` → http://localhost:${proc.port}` : "";
      return {
        processId: id,
        isReused: true,
        message: `♻️ Mevcut process kullanılıyor (ID: ${id})${portInfo}`
      };
    }
  }

  const processId = nextProcessId++;
  
  // Spawn process based on OS
  const shell = isWindows ? "powershell.exe" : "/bin/bash";
  const shellArgs = isWindows ? ["-Command", command] : ["-c", command];
  
  const childProcess = spawn(shell, shellArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
    windowsHide: true
  });

  const bgProcess: BackgroundProcess = {
    id: processId,
    command,
    cwd,
    process: childProcess,
    output: [],
    status: "running",
    startTime: new Date(),
    pid: childProcess.pid
  };

  let portDetected = false;
  let browserOpened = false;

  // Capture stdout
  childProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n").filter(l => l.trim());
    bgProcess.output.push(...lines);
    
    // Print output to console
    process.stdout.write(text);
    
    // Detect port and open browser
    if (!portDetected && autoOpenBrowser) {
      const port = detectPort(text);
      if (port) {
        bgProcess.port = port;
        portDetected = true;
        
        // Wait a bit for server to be ready, then open browser
        if (!browserOpened) {
          browserOpened = true;
          setTimeout(() => {
            const url = `http://localhost:${port}`;
            console.log(`\n🌐 Browser açılıyor: ${url}`);
            openBrowser(url);
          }, 1000);
        }
      }
    }
    
    // Keep only last N lines
    if (bgProcess.output.length > MAX_OUTPUT_LINES) {
      bgProcess.output = bgProcess.output.slice(-MAX_OUTPUT_LINES);
    }
  });

  // Capture stderr
  childProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    const lines = text.split("\n").filter(l => l.trim());
    bgProcess.output.push(...lines.map(l => `[stderr] ${l}`));
    
    // Also print stderr
    process.stderr.write(text);
    
    // Some tools output port info to stderr
    if (!portDetected && autoOpenBrowser) {
      const port = detectPort(text);
      if (port) {
        bgProcess.port = port;
        portDetected = true;
        
        if (!browserOpened) {
          browserOpened = true;
          setTimeout(() => {
            const url = `http://localhost:${port}`;
            console.log(`\n🌐 Browser açılıyor: ${url}`);
            openBrowser(url);
          }, 1000);
        }
      }
    }
    
    if (bgProcess.output.length > MAX_OUTPUT_LINES) {
      bgProcess.output = bgProcess.output.slice(-MAX_OUTPUT_LINES);
    }
  });

  // Handle process exit
  childProcess.on("exit", (code) => {
    bgProcess.status = code === 0 ? "stopped" : "error";
    bgProcess.output.push(`[exit] Process exited with code ${code}`);
  });

  childProcess.on("error", (err) => {
    bgProcess.status = "error";
    bgProcess.output.push(`[error] ${err.message}`);
  });

  processes.set(processId, bgProcess);

  return {
    processId,
    isReused: false,
    message: `🚀 Process başlatıldı (ID: ${processId}, PID: ${childProcess.pid})\n   Çıktı bekleniyor...`
  };
}

/**
 * Kill a process by PID (sync, works on Windows)
 */
function killProcessSync(pid: number): boolean {
  try {
    if (isWindows) {
      // Use taskkill with /T to kill process tree, /F to force
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" });
    } else {
      // Unix: kill process group
      process.kill(-pid, "SIGKILL");
    }
    return true;
  } catch {
    // Process might already be dead
    try {
      if (isWindows) {
        execSync(`taskkill /pid ${pid} /f`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGKILL");
      }
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Stop a background process
 */
export function stopProcess(processId: number): { success: boolean; message: string } {
  const proc = processes.get(processId);
  
  if (!proc) {
    return { success: false, message: `❌ Process bulunamadı: ${processId}` };
  }

  if (proc.status !== "running") {
    return { success: false, message: `⚠️ Process zaten durmuş: ${processId}` };
  }

  try {
    if (proc.pid) {
      killProcessSync(proc.pid);
    }
    proc.process.kill("SIGKILL");
    proc.status = "stopped";
    return { success: true, message: `✅ Process durduruldu: ${processId}` };
  } catch (e: any) {
    proc.status = "stopped"; // Mark as stopped anyway
    return { success: true, message: `✅ Process durduruldu: ${processId}` };
  }
}

/**
 * Get output from a background process
 */
export function getProcessOutput(processId: number, lines: number = 100): { output: string; status: string } {
  const proc = processes.get(processId);
  
  if (!proc) {
    return { output: `❌ Process bulunamadı: ${processId}`, status: "unknown" };
  }

  const outputLines = proc.output.slice(-lines);
  const output = outputLines.length > 0 
    ? outputLines.join("\n")
    : "(henüz output yok)";

  return { output, status: proc.status };
}

/**
 * List all background processes
 */
export function listProcesses(): { processes: Array<{ id: number; command: string; cwd: string; status: string; uptime: string; port?: number }> } {
  const result: Array<{ id: number; command: string; cwd: string; status: string; uptime: string; port?: number }> = [];

  for (const [id, proc] of processes) {
    const uptime = proc.status === "running" 
      ? formatUptime(Date.now() - proc.startTime.getTime())
      : "-";
    
    result.push({
      id,
      command: proc.command.length > 40 ? proc.command.slice(0, 37) + "..." : proc.command,
      cwd: proc.cwd,
      status: proc.status,
      uptime,
      port: proc.port
    });
  }

  return { processes: result };
}

/**
 * Format uptime in human readable format
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Format process list for display
 */
export function formatProcessList(): string {
  const { processes: procs } = listProcesses();
  
  if (procs.length === 0) {
    return "📋 Çalışan process yok.";
  }

  let output = "📋 Background Processes:\n\n";
  output += "  ID  │ Status  │ Uptime │ Port  │ Command\n";
  output += "──────┼─────────┼────────┼───────┼─────────────────────────────\n";
  
  for (const proc of procs) {
    const statusIcon = proc.status === "running" ? "🟢" : 
                       proc.status === "stopped" ? "⚪" : "🔴";
    const portStr = proc.port ? proc.port.toString() : "-";
    output += `  ${proc.id.toString().padEnd(3)} │ ${statusIcon} ${proc.status.padEnd(5)} │ ${proc.uptime.padEnd(6)} │ ${portStr.padEnd(5)} │ ${proc.command}\n`;
  }
  
  output += "\n💡 stop <id> ile durdur, output <id> ile çıktı gör";

  return output;
}

/**
 * Cleanup all processes on exit
 */
export function cleanupAllProcesses(): void {
  console.log("\n🧹 Process'ler kapatılıyor...");
  for (const [id, proc] of processes) {
    if (proc.status === "running" && proc.pid) {
      try {
        killProcessSync(proc.pid);
        proc.status = "stopped";
        console.log(`  ✅ Process ${id} (PID: ${proc.pid}) kapatıldı`);
      } catch {
        console.log(`  ⚠️ Process ${id} kapatılamadı`);
      }
    }
  }
}

// Register cleanup on process exit
process.on("exit", () => {
  // Sync cleanup on exit
  for (const [, proc] of processes) {
    if (proc.status === "running" && proc.pid) {
      try {
        killProcessSync(proc.pid);
      } catch {}
    }
  }
});

process.on("SIGINT", () => {
  cleanupAllProcesses();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupAllProcesses();
  process.exit(0);
});
