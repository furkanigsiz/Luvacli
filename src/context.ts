import * as fs from "fs";
import * as path from "path";

export interface FileContext {
  path: string;
  relativePath: string;
  content: string;
  relevance: number;
  reason: string;
}

export interface ContextWindow {
  files: FileContext[];
  totalTokens: number;
  maxTokens: number;
}

const MAX_CONTEXT_TOKENS = 100000; // ~100k tokens
const CHARS_PER_TOKEN = 4;

// Smart file selection based on query
export function selectRelevantFiles(
  rootDir: string,
  query: string,
  currentFile?: string
): FileContext[] {
  const resolved = path.resolve(rootDir);
  const files: FileContext[] = [];
  const queryLower = query.toLowerCase();
  
  // Keywords to look for
  const keywords = extractKeywords(query);
  
  // Scan and score files
  scanAndScore(resolved, resolved, files, keywords, queryLower, currentFile);
  
  // Sort by relevance
  files.sort((a, b) => b.relevance - a.relevance);
  
  // Fit within token budget
  return fitToTokenBudget(files, MAX_CONTEXT_TOKENS);
}

function extractKeywords(query: string): string[] {
  const stopWords = ["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", 
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
    "bu", "şu", "bir", "ve", "ile", "için", "de", "da", "mi", "mı", "ne", "nasıl"];
  
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w))
    .map(w => w.replace(/[^a-z0-9çğıöşü]/gi, ""));
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".json", ".md"];
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"];

function scanAndScore(
  dir: string,
  root: string,
  files: FileContext[],
  keywords: string[],
  query: string,
  currentFile?: string
) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    if (item.name.startsWith(".") || IGNORE_DIRS.includes(item.name)) continue;
    
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(root, fullPath);
    
    if (item.isDirectory()) {
      scanAndScore(fullPath, root, files, keywords, query, currentFile);
    } else {
      const ext = path.extname(item.name);
      if (!CODE_EXTENSIONS.includes(ext)) continue;
      
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 100000) continue; // Skip files > 100KB
        
        const content = fs.readFileSync(fullPath, "utf-8");
        const score = scoreFile(relativePath, content, keywords, query, currentFile);
        
        if (score.relevance > 0) {
          files.push({
            path: fullPath,
            relativePath,
            content,
            relevance: score.relevance,
            reason: score.reason
          });
        }
      } catch {}
    }
  }
}

function scoreFile(
  relativePath: string,
  content: string,
  keywords: string[],
  query: string,
  currentFile?: string
): { relevance: number; reason: string } {
  let relevance = 0;
  const reasons: string[] = [];
  const pathLower = relativePath.toLowerCase();
  const contentLower = content.toLowerCase();
  
  // Current file gets highest priority
  if (currentFile && relativePath === currentFile) {
    relevance += 100;
    reasons.push("current file");
  }
  
  // Entry points
  if (pathLower.includes("index.") || pathLower.includes("main.") || pathLower.includes("app.")) {
    relevance += 15;
    reasons.push("entry point");
  }
  
  // Config files
  if (pathLower.endsWith("config.ts") || pathLower.endsWith("config.js") || 
      pathLower === "package.json" || pathLower === "tsconfig.json") {
    relevance += 10;
    reasons.push("config");
  }
  
  // Keyword matches in path
  for (const kw of keywords) {
    if (pathLower.includes(kw)) {
      relevance += 20;
      reasons.push(`path: ${kw}`);
    }
  }
  
  // Keyword matches in content
  for (const kw of keywords) {
    const matches = (contentLower.match(new RegExp(kw, "g")) || []).length;
    if (matches > 0) {
      relevance += Math.min(matches * 2, 15);
      if (!reasons.includes(`content: ${kw}`)) reasons.push(`content: ${kw}`);
    }
  }
  
  // Function/class definitions matching keywords
  for (const kw of keywords) {
    const defRegex = new RegExp(`(function|class|interface|type|const|export)\\s+\\w*${kw}\\w*`, "gi");
    if (defRegex.test(content)) {
      relevance += 25;
      reasons.push(`defines: ${kw}`);
    }
  }
  
  return { relevance, reason: reasons.slice(0, 3).join(", ") };
}

function fitToTokenBudget(files: FileContext[], maxTokens: number): FileContext[] {
  const result: FileContext[] = [];
  let totalChars = 0;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  
  for (const file of files) {
    const fileChars = file.content.length + file.relativePath.length + 50; // overhead
    if (totalChars + fileChars > maxChars) {
      // Try to include truncated version
      const remaining = maxChars - totalChars;
      if (remaining > 1000) {
        result.push({
          ...file,
          content: file.content.slice(0, remaining - 100) + "\n... [truncated]"
        });
      }
      break;
    }
    totalChars += fileChars;
    result.push(file);
  }
  
  return result;
}

// Build context string for LLM
export function buildContextString(files: FileContext[]): string {
  if (files.length === 0) return "";
  
  let context = `\n\n=== RELEVANT FILES (${files.length}) ===\n`;
  
  for (const file of files) {
    context += `\n--- ${file.relativePath} [${file.reason}] ---\n`;
    context += "```\n" + file.content + "\n```\n";
  }
  
  return context;
}

// Get context summary
export function getContextSummary(files: FileContext[]): string {
  const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
  const tokens = Math.round(totalChars / CHARS_PER_TOKEN);
  
  let summary = `📋 Context: ${files.length} dosya, ~${tokens} token\n`;
  for (const file of files.slice(0, 10)) {
    summary += `  • ${file.relativePath} (${file.reason})\n`;
  }
  if (files.length > 10) {
    summary += `  ... ve ${files.length - 10} dosya daha\n`;
  }
  
  return summary;
}

// Manual context management
export class ContextManager {
  private pinnedFiles: Set<string> = new Set();
  private excludedFiles: Set<string> = new Set();
  
  pin(filePath: string) {
    this.pinnedFiles.add(filePath);
    this.excludedFiles.delete(filePath);
  }
  
  unpin(filePath: string) {
    this.pinnedFiles.delete(filePath);
  }
  
  exclude(filePath: string) {
    this.excludedFiles.add(filePath);
    this.pinnedFiles.delete(filePath);
  }
  
  include(filePath: string) {
    this.excludedFiles.delete(filePath);
  }
  
  getPinned(): string[] {
    return Array.from(this.pinnedFiles);
  }
  
  isExcluded(filePath: string): boolean {
    return this.excludedFiles.has(filePath);
  }
  
  clear() {
    this.pinnedFiles.clear();
    this.excludedFiles.clear();
  }
  
  getStatus(): string {
    let status = "📌 Context Manager:\n";
    status += `  Pinned: ${this.pinnedFiles.size > 0 ? Array.from(this.pinnedFiles).join(", ") : "none"}\n`;
    status += `  Excluded: ${this.excludedFiles.size > 0 ? Array.from(this.excludedFiles).join(", ") : "none"}\n`;
    return status;
  }
}

export const contextManager = new ContextManager();
