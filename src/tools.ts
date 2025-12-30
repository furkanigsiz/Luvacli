import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { indexCodebase, searchSymbols, findReferences, getFileContext, CodebaseIndex } from "./codebase.js";
import { runAllDiagnostics, checkSyntax, formatDiagnostics, getDiagnostics } from "./diagnostics.js";
import { selectRelevantFiles, buildContextString, getContextSummary, contextManager } from "./context.js";
import { multiFileEdit, rollbackTransaction, listTransactions, FileEdit } from "./multifile.js";
import { takeSnapshot, restoreSnapshot, undoLastChange, getFileHistory, getRecentChanges } from "./history.js";
import { startProcess, stopProcess, getProcessOutput, listProcesses, formatProcessList } from "./process.js";
import { listSteeringFiles, createSteeringFile, discoverSteeringFiles } from "./steering.js";
import { showFileDiff, formatDiffStats, getDiffStats } from "./diff-view.js";
import { checkCommand, checkPath, checkFileWrite, checkFileDelete } from "./security.js";

const execAsync = promisify(exec);

// Codebase index cache
let codebaseCache: { index: CodebaseIndex; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 1 minute

// Tool result cache - avoid re-reading same files
interface CacheEntry {
  result: string;
  timestamp: number;
  hash?: string;
}
const toolCache: Map<string, CacheEntry> = new Map();
const TOOL_CACHE_TTL = 30000; // 30 seconds

function getCacheKey(toolName: string, args: Record<string, any>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

function getFromCache(key: string): string | null {
  const entry = toolCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TOOL_CACHE_TTL) {
    toolCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: string): void {
  // Don't cache errors or very large results
  if (result.startsWith("❌") || result.length > 50000) return;
  toolCache.set(key, { result, timestamp: Date.now() });
  
  // Limit cache size
  if (toolCache.size > 100) {
    const oldest = toolCache.keys().next().value;
    if (oldest) toolCache.delete(oldest);
  }
}

export function clearToolCache(): void {
  toolCache.clear();
}

// Track modified files for auto-diagnostics
const modifiedFiles: Set<string> = new Set();

/**
 * Get and clear modified files list
 */
export function getModifiedFiles(): string[] {
  const files = Array.from(modifiedFiles);
  modifiedFiles.clear();
  return files;
}

/**
 * Check if there are modified files pending diagnostics
 */
export function hasModifiedFiles(): boolean {
  return modifiedFiles.size > 0;
}

/**
 * Track a file modification
 */
function trackModifiedFile(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const diagnosticExtensions = [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".json"];
  if (diagnosticExtensions.includes(ext)) {
    modifiedFiles.add(filePath);
  }
}

// Tool definitions for Gemini Function Calling
export const toolDeclarations: any[] = [
  {
    name: "read_file",
    description: "Bir dosyanın içeriğini okur",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Okunacak dosyanın yolu" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Bir dosyaya içerik yazar",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Yazılacak dosyanın yolu" },
        content: { type: "string", description: "Dosyaya yazılacak içerik" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "append_file",
    description: "Bir dosyanın sonuna içerik ekler",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Dosya yolu" },
        content: { type: "string", description: "Eklenecek içerik" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "list_directory",
    description: "Bir klasördeki dosya ve klasörleri listeler",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Listelenecek klasör yolu" }
      },
      required: ["path"]
    }
  },
  {
    name: "run_command",
    description: "Terminal/PowerShell komutu çalıştırır",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Çalıştırılacak komut" },
        cwd: { type: "string", description: "Komutun çalıştırılacağı dizin" }
      },
      required: ["command"]
    }
  },
  {
    name: "create_directory",
    description: "Yeni bir klasör oluşturur",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Oluşturulacak klasör yolu" }
      },
      required: ["path"]
    }
  },
  {
    name: "delete_file",
    description: "Bir dosya veya boş klasörü siler",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Silinecek dosya/klasör yolu" }
      },
      required: ["path"]
    }
  },
  {
    name: "search_files",
    description: "Dosyalarda metin arar",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Aranacak klasör" },
        pattern: { type: "string", description: "Aranacak metin" },
        extension: { type: "string", description: "Dosya uzantısı filtresi" }
      },
      required: ["directory", "pattern"]
    }
  },
  {
    name: "edit_file",
    description: "Dosyada belirli bir metni başka bir metinle değiştirir",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Düzenlenecek dosyanın yolu" },
        old_text: { type: "string", description: "Değiştirilecek mevcut metin" },
        new_text: { type: "string", description: "Yeni metin" }
      },
      required: ["path", "old_text", "new_text"]
    }
  },
  {
    name: "git_status",
    description: "Git durumunu gösterir",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Git repo dizini" }
      },
      required: ["directory"]
    }
  },
  {
    name: "git_diff",
    description: "Git diff gösterir",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Git repo dizini" },
        file: { type: "string", description: "Belirli bir dosyanın diff'i" }
      },
      required: ["directory"]
    }
  },
  {
    name: "git_commit",
    description: "Değişiklikleri commit eder",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Git repo dizini" },
        message: { type: "string", description: "Commit mesajı" },
        add_all: { type: "boolean", description: "Tüm değişiklikleri ekle" }
      },
      required: ["directory", "message"]
    }
  },
  {
    name: "web_search",
    description: "Web'de arama yapar",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Arama sorgusu" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_file_structure",
    description: "Proje yapısını ağaç şeklinde gösterir",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Taranacak klasör" },
        max_depth: { type: "number", description: "Maksimum derinlik" }
      },
      required: ["directory"]
    }
  },
  // Codebase Indexing Tools
  {
    name: "index_codebase",
    description: "Projeyi indexler - dosyalar, semboller, bağımlılıklar. Tüm projeyi anlamak için kullan.",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje kök dizini" }
      },
      required: ["directory"]
    }
  },
  {
    name: "search_symbols",
    description: "Codebase'de fonksiyon, class, interface ara",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        query: { type: "string", description: "Aranacak sembol adı" }
      },
      required: ["directory", "query"]
    }
  },
  {
    name: "find_references",
    description: "Bir sembolün tüm kullanımlarını bul",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        symbol: { type: "string", description: "Sembol adı" }
      },
      required: ["directory", "symbol"]
    }
  },
  {
    name: "get_file_context",
    description: "Dosyanın import/export ve bağımlılıklarını göster",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        file: { type: "string", description: "Dosya yolu" }
      },
      required: ["directory", "file"]
    }
  },
  // Diagnostics Tools
  {
    name: "get_diagnostics",
    description: "Belirli dosyaların compile, lint, type ve semantic hatalarını kontrol et. Kod düzenledikten sonra doğrulama için kullan.",
    parameters: {
      type: "object",
      properties: {
        paths: { 
          type: "array", 
          items: { type: "string" },
          description: "Kontrol edilecek dosya yolları listesi" 
        }
      },
      required: ["paths"]
    }
  },
  {
    name: "run_diagnostics",
    description: "Tüm proje için TypeScript ve ESLint hatalarını kontrol et",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" }
      },
      required: ["directory"]
    }
  },
  {
    name: "check_file_syntax",
    description: "Tek bir dosyanın syntax hatalarını kontrol et",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Kontrol edilecek dosya" }
      },
      required: ["path"]
    }
  },
  // Context Management Tools
  {
    name: "get_relevant_context",
    description: "Sorguya göre ilgili dosyaları otomatik seç ve context oluştur",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        query: { type: "string", description: "Ne hakkında context isteniyor" },
        current_file: { type: "string", description: "Şu an üzerinde çalışılan dosya" }
      },
      required: ["directory", "query"]
    }
  },
  {
    name: "pin_file",
    description: "Dosyayı context'e sabitle (her zaman dahil edilsin)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Sabitlenecek dosya" }
      },
      required: ["path"]
    }
  },
  {
    name: "unpin_file",
    description: "Dosyayı context'ten çıkar",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Çıkarılacak dosya" }
      },
      required: ["path"]
    }
  },
  {
    name: "context_status",
    description: "Context manager durumunu göster",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Multi-file Edit Tools
  {
    name: "multi_file_edit",
    description: "Birden fazla dosyayı atomik olarak düzenle (rollback destekli)",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "Düzenleme listesi",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Dosya yolu" },
              type: { type: "string", enum: ["create", "modify", "delete"], description: "İşlem tipi" },
              content: { type: "string", description: "Yeni içerik (create/modify için)" },
              old_text: { type: "string", description: "Değiştirilecek metin (modify için)" },
              new_text: { type: "string", description: "Yeni metin (modify için)" }
            },
            required: ["path", "type"]
          }
        }
      },
      required: ["edits"]
    }
  },
  {
    name: "rollback_transaction",
    description: "Bir transaction'ı geri al",
    parameters: {
      type: "object",
      properties: {
        transaction_id: { type: "string", description: "Geri alınacak transaction ID" }
      },
      required: ["transaction_id"]
    }
  },
  {
    name: "list_transactions",
    description: "Son transaction'ları listele",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Undo/Restore Tools
  {
    name: "undo",
    description: "Son değişikliği geri al (Cursor/Kiro restore gibi)",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Belirli bir dosya için geri al (opsiyonel)" }
      },
      required: []
    }
  },
  {
    name: "restore",
    description: "Belirli bir snapshot'a geri dön",
    parameters: {
      type: "object",
      properties: {
        snapshot_id: { type: "string", description: "Geri dönülecek snapshot ID" }
      },
      required: ["snapshot_id"]
    }
  },
  {
    name: "history",
    description: "Dosya veya genel değişiklik geçmişini göster",
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Belirli dosyanın geçmişi (opsiyonel)" },
        count: { type: "number", description: "Kaç kayıt gösterilsin" }
      },
      required: []
    }
  },
  // Background Process Tools
  {
    name: "start_process",
    description: "Arka planda uzun süren bir process başlat (dev server, watcher vb.)",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Çalıştırılacak komut (örn: npm run dev)" },
        cwd: { type: "string", description: "Çalışma dizini" }
      },
      required: ["command"]
    }
  },
  {
    name: "stop_process",
    description: "Çalışan bir background process'i durdur",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "number", description: "Durdurulacak process ID" }
      },
      required: ["process_id"]
    }
  },
  {
    name: "get_process_output",
    description: "Background process'in çıktısını oku",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "number", description: "Process ID" },
        lines: { type: "number", description: "Kaç satır gösterilsin (varsayılan: 100)" }
      },
      required: ["process_id"]
    }
  },
  {
    name: "list_processes",
    description: "Tüm background process'leri listele",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Steering Tools
  {
    name: "list_steering",
    description: "Proje steering dosyalarını listele (.luva/steering/*.md)",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" }
      },
      required: ["directory"]
    }
  },
  {
    name: "create_steering",
    description: "Yeni bir steering dosyası oluştur",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        name: { type: "string", description: "Steering dosyası adı" },
        content: { type: "string", description: "Steering içeriği (markdown)" },
        inclusion: { type: "string", enum: ["always", "fileMatch", "manual"], description: "Dahil etme modu" },
        file_match_pattern: { type: "string", description: "fileMatch için glob pattern" },
        description: { type: "string", description: "Kısa açıklama" }
      },
      required: ["directory", "name", "content"]
    }
  },
  {
    name: "read_steering",
    description: "Bir steering dosyasının içeriğini oku",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Proje dizini" },
        name: { type: "string", description: "Steering dosyası adı" }
      },
      required: ["directory", "name"]
    }
  }
];


// Tool execution functions
export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  // Check cache for read-only operations
  const cacheableTools = ["read_file", "list_directory", "get_file_structure", "search_files", "git_status"];
  const cacheKey = getCacheKey(name, args);
  
  if (cacheableTools.includes(name)) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached + "\n\x1b[2m(cached)\x1b[0m";
    }
  }
  
  try {
    let result: string;
    switch (name) {
      case "read_file": result = readFile(args.path); break;
      case "write_file": result = writeFile(args.path, args.content); clearToolCache(); break;
      case "append_file": result = appendFile(args.path, args.content); clearToolCache(); break;
      case "list_directory": result = listDirectory(args.path); break;
      case "run_command": result = await runCommand(args.command, args.cwd); break;
      case "create_directory": result = createDirectory(args.path); break;
      case "delete_file": result = deleteFile(args.path); clearToolCache(); break;
      case "search_files": result = searchFiles(args.directory, args.pattern, args.extension); break;
      case "edit_file": result = editFile(args.path, args.old_text, args.new_text); clearToolCache(); break;
      case "git_status": result = await gitStatus(args.directory); break;
      case "git_diff": result = await gitDiff(args.directory, args.file); break;
      case "git_commit": result = await gitCommit(args.directory, args.message, args.add_all); break;
      case "web_search": result = await webSearch(args.query); break;
      case "get_file_structure": result = getFileStructure(args.directory, args.max_depth || 3); break;
      // Codebase tools
      case "index_codebase": result = await indexCodebaseCmd(args.directory); break;
      case "search_symbols": result = await searchSymbolsCmd(args.directory, args.query); break;
      case "find_references": result = await findReferencesCmd(args.directory, args.symbol); break;
      case "get_file_context": result = await getFileContextCmd(args.directory, args.file); break;
      // Diagnostics tools
      case "get_diagnostics": result = await getDiagnosticsCmd(args.paths); break;
      case "run_diagnostics": result = await runDiagnosticsCmd(args.directory); break;
      case "check_file_syntax": result = checkFileSyntaxCmd(args.path); break;
      // Context tools
      case "get_relevant_context": result = getRelevantContextCmd(args.directory, args.query, args.current_file); break;
      case "pin_file": result = pinFileCmd(args.path); break;
      case "unpin_file": result = unpinFileCmd(args.path); break;
      case "context_status": result = contextStatusCmd(); break;
      // Multi-file tools
      case "multi_file_edit": result = multiFileEditCmd(args.edits); clearToolCache(); break;
      case "rollback_transaction": result = rollbackTransactionCmd(args.transaction_id); clearToolCache(); break;
      case "list_transactions": result = listTransactionsCmd(); break;
      // Undo/Restore tools
      case "undo": result = undoCmd(args.file); clearToolCache(); break;
      case "restore": result = restoreCmd(args.snapshot_id); clearToolCache(); break;
      case "history": result = historyCmd(args.file, args.count); break;
      // Background Process tools
      case "start_process": result = startProcessCmd(args.command, args.cwd); break;
      case "stop_process": result = stopProcessCmd(args.process_id); break;
      case "get_process_output": result = getProcessOutputCmd(args.process_id, args.lines); break;
      case "list_processes": result = listProcessesCmd(); break;
      // Steering tools
      case "list_steering": result = listSteeringCmd(args.directory); break;
      case "create_steering": result = createSteeringCmd(args.directory, args.name, args.content, args.inclusion, args.file_match_pattern, args.description); break;
      case "read_steering": result = readSteeringCmd(args.directory, args.name); break;
      default: result = `Bilinmeyen tool: ${name}`;
    }
    
    // Cache result
    if (cacheableTools.includes(name)) {
      setCache(cacheKey, result);
    }
    
    return result;
  } catch (error: any) {
    return `❌ Hata: ${error.message}`;
  }
}

// Execute multiple tools in parallel
export async function executeToolsParallel(tools: Array<{ name: string; args: Record<string, any> }>): Promise<string[]> {
  return Promise.all(tools.map(t => executeTool(t.name, t.args)));
}

function resolvePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(process.cwd(), filePath);
}

function readFile(filePath: string): string {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return `❌ Dosya bulunamadı: ${resolved}`;
  
  const content = fs.readFileSync(resolved, "utf-8");
  const lines = content.split("\n");
  const ext = path.extname(resolved).slice(1) || "txt";
  const size = fs.statSync(resolved).size;
  
  // Format file size
  const sizeStr = size < 1024 ? `${size}B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)}KB` : `${(size / 1024 / 1024).toFixed(1)}MB`;
  
  // Terminal'e özet göster, AI'a tam içerik gönder
  const summary = `📄 ${resolved} (${lines.length} satır, ${sizeStr})`;
  
  // AI'a gönderilecek tam içerik (console.log'a değil, return'e)
  return `${summary}\n\`\`\`${ext}\n${content}\n\`\`\``;
}

function writeFile(filePath: string, content: string): string {
  // Güvenlik kontrolü - path jail
  const securityCheck = checkFileWrite(filePath);
  if (!securityCheck.allowed) {
    return `🔒 ${securityCheck.reason}`;
  }
  if (securityCheck.warning) {
    console.log(`\x1b[33m⚠️  ${securityCheck.warning}\x1b[0m`);
  }
  
  const resolved = resolvePath(filePath);
  const dir = path.dirname(resolved);
  
  const isNew = !fs.existsSync(resolved);
  
  // Get old content for diff BEFORE writing
  const oldContent = isNew ? "" : fs.readFileSync(resolved, "utf-8");
  
  // Take snapshot before writing
  takeSnapshot(resolved, isNew ? "create" : "write", `write_file: ${filePath}`);
  
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  
  // Track for auto-diagnostics
  trackModifiedFile(resolved);
  
  // Show diff for existing files
  if (!isNew && oldContent !== content) {
    const diffOutput = showFileDiff(resolved, content, oldContent);
    const stats = getDiffStats(oldContent, content);
    return `✅ Dosya yazıldı: ${resolved} ${formatDiffStats(stats)}\n\n${diffOutput}`;
  }
  
  return `✅ ${isNew ? "Dosya oluşturuldu" : "Dosya yazıldı"}: ${resolved}`;
}

function appendFile(filePath: string, content: string): string {
  // Güvenlik kontrolü
  const securityCheck = checkFileWrite(filePath);
  if (!securityCheck.allowed) {
    return `🔒 ${securityCheck.reason}`;
  }
  
  const resolved = resolvePath(filePath);
  
  // Take snapshot before appending
  takeSnapshot(resolved, "edit", `append_file: ${filePath}`);
  
  fs.appendFileSync(resolved, content, "utf-8");
  
  // Track for auto-diagnostics
  trackModifiedFile(resolved);
  
  return `✅ Dosyaya eklendi: ${resolved}`;
}

function listDirectory(dirPath: string): string {
  const resolved = resolvePath(dirPath);
  if (!fs.existsSync(resolved)) return `Klasör bulunamadı: ${resolved}`;
  const items = fs.readdirSync(resolved, { withFileTypes: true });
  const list = items.map(item => `${item.isDirectory() ? "📁" : "📄"} ${item.name}`).join("\n");
  return `📂 ${resolved}:\n${list}`;
}

async function runCommand(command: string, cwd?: string): Promise<string> {
  // Güvenlik kontrolü
  const securityCheck = checkCommand(command);
  if (!securityCheck.allowed) {
    return `🔒 ${securityCheck.reason}`;
  }
  if (securityCheck.warning) {
    console.log(`\x1b[33m⚠️  ${securityCheck.warning}\x1b[0m`);
  }
  
  const options: any = { timeout: 60000, shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash" };
  if (cwd) options.cwd = resolvePath(cwd);
  
  // Windows'ta && yerine ; kullan veya komutları ayır
  let cmd = command;
  if (process.platform === "win32") {
    // && içeren komutları ; ile değiştir (PowerShell için)
    cmd = command.replace(/\s*&&\s*/g, "; ");
  }
  
  try {
    const { stdout, stderr } = await execAsync(cmd, options);
    let result = "";
    if (stdout) result += `📤 Output:\n${stdout}`;
    if (stderr) result += `\n⚠️ Stderr:\n${stderr}`;
    return result || "✅ Komut başarıyla çalıştı";
  } catch (error: any) {
    return `❌ Komut hatası: ${error.message}`;
  }
}

function createDirectory(dirPath: string): string {
  const resolved = resolvePath(dirPath);
  fs.mkdirSync(resolved, { recursive: true });
  return `✅ Klasör oluşturuldu: ${resolved}`;
}

function deleteFile(filePath: string): string {
  // Güvenlik kontrolü
  const securityCheck = checkFileDelete(filePath);
  if (!securityCheck.allowed) {
    return `🔒 ${securityCheck.reason}`;
  }
  
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return `Dosya/klasör bulunamadı: ${resolved}`;
  
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    fs.rmdirSync(resolved);
  } else {
    // Take snapshot before deleting
    takeSnapshot(resolved, "delete", `delete_file: ${filePath}`);
    fs.unlinkSync(resolved);
  }
  return `✅ Silindi: ${resolved}`;
}

function searchFiles(directory: string, pattern: string, extension?: string): string {
  const resolved = resolvePath(directory);
  const results: string[] = [];
  const regex = new RegExp(pattern, "gi");
  
  function searchDir(dir: string) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") {
        searchDir(fullPath);
      } else if (item.isFile()) {
        if (extension && !item.name.endsWith(extension)) continue;
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          content.split("\n").forEach((line, i) => {
            if (regex.test(line)) results.push(`${fullPath}:${i + 1}: ${line.trim()}`);
          });
        } catch {}
      }
    }
  }
  
  searchDir(resolved);
  if (results.length === 0) return "Sonuç bulunamadı.";
  return `🔍 Bulunan (${results.length}):\n${results.slice(0, 20).join("\n")}`;
}

function editFile(filePath: string, oldText: string, newText: string): string {
  // Güvenlik kontrolü
  const securityCheck = checkFileWrite(filePath);
  if (!securityCheck.allowed) {
    return `🔒 ${securityCheck.reason}`;
  }
  
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) return `❌ Dosya bulunamadı: ${resolved}`;
  
  const content = fs.readFileSync(resolved, "utf-8");
  if (!content.includes(oldText)) return `❌ Metin bulunamadı dosyada.`;
  
  // Take snapshot before editing
  takeSnapshot(resolved, "edit", `edit_file: ${filePath}`);
  
  fs.writeFileSync(resolved, content.replace(oldText, newText), "utf-8");
  
  // Track for auto-diagnostics
  trackModifiedFile(resolved);
  
  return `✅ Düzenleme yapıldı: ${resolved}`;
}

async function gitStatus(directory: string): Promise<string> {
  const resolved = resolvePath(directory);
  try {
    const { stdout: branch } = await execAsync("git branch --show-current", { cwd: resolved });
    const { stdout: status } = await execAsync("git status --short", { cwd: resolved });
    return `🌿 Branch: ${branch.trim()}\n📋 Değişiklikler:\n${status || "Değişiklik yok"}`;
  } catch (error: any) {
    return `❌ Git hatası: ${error.message}`;
  }
}

async function gitDiff(directory: string, file?: string): Promise<string> {
  const resolved = resolvePath(directory);
  try {
    const { stdout } = await execAsync(file ? `git diff ${file}` : "git diff", { cwd: resolved });
    if (!stdout) return "Değişiklik yok.";
    return `📊 Diff:\n\`\`\`diff\n${stdout.slice(0, 3000)}\n\`\`\``;
  } catch (error: any) {
    return `❌ Git hatası: ${error.message}`;
  }
}

async function gitCommit(directory: string, message: string, addAll?: boolean): Promise<string> {
  const resolved = resolvePath(directory);
  try {
    if (addAll) await execAsync("git add .", { cwd: resolved });
    const { stdout } = await execAsync(`git commit -m "${message}"`, { cwd: resolved });
    return `✅ Commit yapıldı:\n${stdout}`;
  } catch (error: any) {
    return `❌ Git hatası: ${error.message}`;
  }
}

async function webSearch(query: string): Promise<string> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(url);
    const data = await response.json() as any;
    let result = `🔍 "${query}":\n`;
    if (data.Abstract) result += `📖 ${data.Abstract}\n🔗 ${data.AbstractURL || ""}\n`;
    if (data.RelatedTopics?.length > 0) {
      result += "\n📌 İlgili:\n";
      data.RelatedTopics.slice(0, 5).forEach((t: any) => { if (t.Text) result += `• ${t.Text.slice(0, 100)}...\n`; });
    }
    return result || "Sonuç bulunamadı.";
  } catch (error: any) {
    return `❌ Arama hatası: ${error.message}`;
  }
}

function getFileStructure(directory: string, maxDepth: number): string {
  const resolved = resolvePath(directory);
  const lines: string[] = [`📂 ${resolved}`];
  
  function traverse(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;
    const items = fs.readdirSync(dir, { withFileTypes: true })
      .filter(i => !i.name.startsWith(".") && i.name !== "node_modules")
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    
    items.forEach((item, idx) => {
      const isLast = idx === items.length - 1;
      lines.push(`${prefix}${isLast ? "└── " : "├── "}${item.isDirectory() ? "📁" : "📄"} ${item.name}`);
      if (item.isDirectory()) traverse(path.join(dir, item.name), prefix + (isLast ? "    " : "│   "), depth + 1);
    });
  }
  
  traverse(resolved, "", 1);
  return lines.join("\n");
}


// ============ Codebase Indexing Functions ============

async function getOrCreateIndex(directory: string): Promise<CodebaseIndex> {
  const resolved = resolvePath(directory);
  
  // Check cache
  if (codebaseCache && codebaseCache.index.root === resolved && Date.now() - codebaseCache.timestamp < CACHE_TTL) {
    return codebaseCache.index;
  }
  
  // Create new index
  const index = await indexCodebase(resolved);
  codebaseCache = { index, timestamp: Date.now() };
  return index;
}

async function indexCodebaseCmd(directory: string): Promise<string> {
  const index = await getOrCreateIndex(directory);
  return index.summary;
}

async function searchSymbolsCmd(directory: string, query: string): Promise<string> {
  const index = await getOrCreateIndex(directory);
  const results = searchSymbols(index, query);
  
  if (results.length === 0) {
    return `🔍 "${query}" için sembol bulunamadı.`;
  }
  
  let output = `🔍 "${query}" için ${results.length} sonuç:\n\n`;
  for (const { file, symbol } of results.slice(0, 20)) {
    const icon = symbol.kind === "function" ? "ƒ" : symbol.kind === "class" ? "C" : symbol.kind === "interface" ? "I" : "•";
    output += `${icon} ${symbol.name} (${symbol.kind}) - ${file}:${symbol.line}${symbol.exported ? " [export]" : ""}\n`;
  }
  
  return output;
}

async function findReferencesCmd(directory: string, symbol: string): Promise<string> {
  const index = await getOrCreateIndex(directory);
  const refs = findReferences(index, symbol);
  
  if (refs.length === 0) {
    return `🔍 "${symbol}" için referans bulunamadı.`;
  }
  
  return `🔍 "${symbol}" referansları (${refs.length}):\n\n${refs.join("\n")}`;
}

async function getFileContextCmd(directory: string, file: string): Promise<string> {
  const index = await getOrCreateIndex(directory);
  return getFileContext(index, file);
}

// ============ Diagnostics Functions ============

async function getDiagnosticsCmd(paths: string[]): Promise<string> {
  if (!paths || paths.length === 0) {
    return "❌ En az bir dosya yolu gerekli.";
  }
  
  const result = await getDiagnostics(paths);
  return formatDiagnostics(result);
}

async function runDiagnosticsCmd(directory: string): Promise<string> {
  const resolved = resolvePath(directory);
  const result = await runAllDiagnostics(resolved);
  return formatDiagnostics(result);
}

function checkFileSyntaxCmd(filePath: string): string {
  const resolved = resolvePath(filePath);
  
  if (!fs.existsSync(resolved)) {
    return `❌ Dosya bulunamadı: ${resolved}`;
  }
  
  const diagnostics = checkSyntax(resolved);
  
  if (diagnostics.length === 0) {
    return `✅ ${filePath}: Syntax hatası yok`;
  }
  
  let output = `📄 ${filePath} - ${diagnostics.length} hata:\n`;
  for (const d of diagnostics) {
    output += `  ❌ ${d.line}:${d.column} ${d.message}\n`;
  }
  
  return output;
}


// ============ Context Management Functions ============

function getRelevantContextCmd(directory: string, query: string, currentFile?: string): string {
  const resolved = resolvePath(directory);
  const files = selectRelevantFiles(resolved, query, currentFile);
  
  if (files.length === 0) {
    return "📋 İlgili dosya bulunamadı.";
  }
  
  const summary = getContextSummary(files);
  const context = buildContextString(files);
  
  return summary + context;
}

function pinFileCmd(filePath: string): string {
  const resolved = resolvePath(filePath);
  if (!fs.existsSync(resolved)) {
    return `❌ Dosya bulunamadı: ${filePath}`;
  }
  contextManager.pin(filePath);
  return `📌 Pinned: ${filePath}`;
}

function unpinFileCmd(filePath: string): string {
  contextManager.unpin(filePath);
  return `📌 Unpinned: ${filePath}`;
}

function contextStatusCmd(): string {
  return contextManager.getStatus();
}

// ============ Multi-file Edit Functions ============

function multiFileEditCmd(edits: any[]): string {
  const fileEdits: FileEdit[] = edits.map(e => ({
    path: e.path,
    type: e.type,
    content: e.content,
    oldText: e.old_text,
    newText: e.new_text
  }));
  
  return multiFileEdit(fileEdits);
}

function rollbackTransactionCmd(transactionId: string): string {
  const result = rollbackTransaction(transactionId);
  return result.message;
}

function listTransactionsCmd(): string {
  return listTransactions();
}


// ============ Undo/Restore Functions ============

function undoCmd(filePath?: string): string {
  const result = undoLastChange(filePath);
  return result.message;
}

function restoreCmd(snapshotId: string): string {
  const result = restoreSnapshot(snapshotId);
  return result.message;
}

function historyCmd(filePath?: string, count?: number): string {
  if (filePath) {
    return getFileHistory(filePath);
  }
  return getRecentChanges(count || 10);
}


// ============ Background Process Functions ============

function startProcessCmd(command: string, cwd?: string): string {
  const workDir = cwd ? resolvePath(cwd) : process.cwd();
  const result = startProcess(command, workDir);
  return result.message;
}

function stopProcessCmd(processId: number): string {
  const result = stopProcess(processId);
  return result.message;
}

function getProcessOutputCmd(processId: number, lines?: number): string {
  const result = getProcessOutput(processId, lines);
  return `📋 Process ${processId} [${result.status}]:\n\n${result.output}`;
}

function listProcessesCmd(): string {
  return formatProcessList();
}

// ============ Steering Functions ============

function listSteeringCmd(directory: string): string {
  const resolved = resolvePath(directory);
  return listSteeringFiles(resolved);
}

function createSteeringCmd(
  directory: string,
  name: string,
  content: string,
  inclusion?: string,
  fileMatchPattern?: string,
  description?: string
): string {
  const resolved = resolvePath(directory);
  const filePath = createSteeringFile(resolved, name, content, {
    inclusion,
    fileMatchPattern,
    description
  });
  return `✅ Steering dosyası oluşturuldu: ${filePath}`;
}

function readSteeringCmd(directory: string, name: string): string {
  const resolved = resolvePath(directory);
  const files = discoverSteeringFiles(resolved);
  const file = files.find(f => f.name === name || f.name === name.replace(".md", ""));
  
  if (!file) {
    return `❌ Steering dosyası bulunamadı: ${name}`;
  }
  
  let output = `📋 ${file.name} [${file.inclusion}]\n`;
  if (file.description) output += `📝 ${file.description}\n`;
  if (file.fileMatchPattern) output += `🎯 Pattern: ${file.fileMatchPattern}\n`;
  output += `\n${file.content}`;
  
  return output;
}
