import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: string;
  code?: string;
}

export interface DiagnosticsResult {
  diagnostics: Diagnostic[];
  summary: string;
  hasErrors: boolean;
}

/**
 * Get diagnostics for specific files (Kiro-style getDiagnostics)
 * This is the main entry point for file-specific diagnostics
 */
export async function getDiagnostics(filePaths: string[]): Promise<DiagnosticsResult> {
  const allDiagnostics: Diagnostic[] = [];
  const cwd = process.cwd();
  
  for (const filePath of filePaths) {
    const resolved = path.resolve(cwd, filePath);
    
    if (!fs.existsSync(resolved)) {
      allDiagnostics.push({
        file: filePath,
        line: 1,
        column: 1,
        severity: "error",
        message: `Dosya bulunamadı: ${filePath}`,
        source: "filesystem"
      });
      continue;
    }
    
    const ext = path.extname(resolved);
    
    // TypeScript/JavaScript files
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
      // Skip basic syntax check for TSX/JSX - JSX syntax confuses simple bracket matching
      // TypeScript compiler will catch real syntax errors
      if (![".tsx", ".jsx"].includes(ext)) {
        const syntaxErrors = checkSyntax(resolved);
        allDiagnostics.push(...syntaxErrors);
      }
      
      // TypeScript type checking for TS files
      if ([".ts", ".tsx"].includes(ext)) {
        const tsErrors = await getTypeScriptDiagnosticsForFile(resolved);
        allDiagnostics.push(...tsErrors);
      }
      
      // ESLint if available
      const eslintErrors = await getESLintDiagnosticsForFile(resolved);
      allDiagnostics.push(...eslintErrors);
    }
    
    // JSON files
    if (ext === ".json") {
      const jsonErrors = checkSyntax(resolved);
      allDiagnostics.push(...jsonErrors);
    }
    
    // CSS/SCSS files
    if ([".css", ".scss", ".less"].includes(ext)) {
      const cssErrors = checkCSSSyntax(resolved);
      allDiagnostics.push(...cssErrors);
    }
  }
  
  const errors = allDiagnostics.filter(d => d.severity === "error").length;
  const warnings = allDiagnostics.filter(d => d.severity === "warning").length;
  
  return {
    diagnostics: allDiagnostics,
    summary: errors === 0 && warnings === 0 
      ? `✅ ${filePaths.length} dosya kontrol edildi, sorun yok`
      : `🔍 ${filePaths.length} dosya: ${errors} hata, ${warnings} uyarı`,
    hasErrors: errors > 0
  };
}

/**
 * Get TypeScript diagnostics for a single file
 */
async function getTypeScriptDiagnosticsForFile(filePath: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const dir = path.dirname(filePath);
  
  // Skip node_modules files
  if (filePath.includes("node_modules")) {
    return diagnostics;
  }
  
  // Find tsconfig - prefer tsconfig.app.json for Vite projects
  let tsconfigDir = dir;
  let tsconfigFile = "tsconfig.json";
  
  while (tsconfigDir !== path.dirname(tsconfigDir)) {
    // Vite projects use tsconfig.app.json for app code
    if (fs.existsSync(path.join(tsconfigDir, "tsconfig.app.json"))) {
      tsconfigFile = "tsconfig.app.json";
      break;
    }
    if (fs.existsSync(path.join(tsconfigDir, "tsconfig.json"))) {
      break;
    }
    tsconfigDir = path.dirname(tsconfigDir);
  }
  
  const tsconfigPath = path.join(tsconfigDir, tsconfigFile);
  if (!fs.existsSync(tsconfigPath)) {
    return diagnostics;
  }
  
  try {
    const relPath = path.relative(tsconfigDir, filePath);
    // Use -p flag to specify the correct tsconfig
    await execAsync(`npx tsc --noEmit --pretty false -p "${tsconfigFile}" "${relPath}" 2>&1`, {
      cwd: tsconfigDir,
      timeout: 30000,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash"
    });
  } catch (error: any) {
    const output = error.stdout || error.message || "";
    const lines = output.split("\n");
    
    for (const line of lines) {
      // Skip node_modules errors
      if (line.includes("node_modules")) continue;
      
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/);
      if (match) {
        diagnostics.push({
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          severity: match[4] as "error" | "warning",
          code: match[5],
          message: match[6],
          source: "typescript"
        });
      }
    }
  }
  
  return diagnostics;
}

/**
 * Get ESLint diagnostics for a single file
 */
async function getESLintDiagnosticsForFile(filePath: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const dir = path.dirname(filePath);
  
  // Find eslint config
  const eslintConfigs = [".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"];
  let eslintDir = dir;
  let hasEslint = false;
  
  while (eslintDir !== path.dirname(eslintDir)) {
    if (eslintConfigs.some(c => fs.existsSync(path.join(eslintDir, c)))) {
      hasEslint = true;
      break;
    }
    eslintDir = path.dirname(eslintDir);
  }
  
  if (!hasEslint) {
    return diagnostics;
  }
  
  try {
    const { stdout } = await execAsync(`npx eslint "${filePath}" --format json 2>&1`, {
      cwd: eslintDir,
      timeout: 30000,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash"
    });
    
    const results = JSON.parse(stdout);
    for (const result of results) {
      for (const msg of result.messages || []) {
        diagnostics.push({
          file: path.relative(process.cwd(), result.filePath),
          line: msg.line || 1,
          column: msg.column || 1,
          severity: msg.severity === 2 ? "error" : "warning",
          message: msg.message,
          code: msg.ruleId,
          source: "eslint"
        });
      }
    }
  } catch (error: any) {
    try {
      const output = error.stdout || "";
      if (output.startsWith("[")) {
        const results = JSON.parse(output);
        for (const result of results) {
          for (const msg of result.messages || []) {
            diagnostics.push({
              file: path.relative(process.cwd(), result.filePath),
              line: msg.line || 1,
              column: msg.column || 1,
              severity: msg.severity === 2 ? "error" : "warning",
              message: msg.message,
              code: msg.ruleId,
              source: "eslint"
            });
          }
        }
      }
    } catch {}
  }
  
  return diagnostics;
}

/**
 * Check CSS/SCSS syntax
 */
function checkCSSSyntax(filePath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    
    let braceCount = 0;
    let inComment = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const next = j < line.length - 1 ? line[j + 1] : "";
        
        // Handle comments
        if (char === "/" && next === "*") { inComment = true; continue; }
        if (char === "*" && next === "/") { inComment = false; j++; continue; }
        if (inComment) continue;
        
        if (char === "{") braceCount++;
        if (char === "}") braceCount--;
        
        if (braceCount < 0) {
          diagnostics.push({
            file: filePath,
            line: i + 1,
            column: j + 1,
            severity: "error",
            message: "Fazla kapanan süslü parantez",
            source: "css"
          });
          braceCount = 0;
        }
      }
    }
    
    if (braceCount > 0) {
      diagnostics.push({
        file: filePath,
        line: lines.length,
        column: 1,
        severity: "error",
        message: `${braceCount} adet kapatılmamış süslü parantez`,
        source: "css"
      });
    }
  } catch {}
  
  return diagnostics;
}

// Run TypeScript compiler for diagnostics
export async function runTypeScriptDiagnostics(rootDir: string): Promise<DiagnosticsResult> {
  const diagnostics: Diagnostic[] = [];
  const resolved = path.resolve(rootDir);
  
  // Check if tsconfig exists
  const tsconfigPath = path.join(resolved, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return { diagnostics: [], summary: "⚠️ tsconfig.json bulunamadı", hasErrors: false };
  }

  try {
    // Run tsc --noEmit for type checking only
    await execAsync("npx tsc --noEmit --pretty false 2>&1", { 
      cwd: resolved, 
      timeout: 60000,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash"
    });
    return { diagnostics: [], summary: "✅ TypeScript: Hata yok", hasErrors: false };
  } catch (error: any) {
    // Parse tsc output
    const output = error.stdout || error.message || "";
    const lines = output.split("\n");
    
    for (const line of lines) {
      // Format: src/file.ts(10,5): error TS2322: Type 'string' is not assignable...
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)/);
      if (match) {
        diagnostics.push({
          file: match[1],
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          severity: match[4] as "error" | "warning",
          code: match[5],
          message: match[6],
          source: "typescript"
        });
      }
    }
  }

  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.filter(d => d.severity === "warning").length;
  
  return {
    diagnostics,
    summary: `🔍 TypeScript: ${errors} hata, ${warnings} uyarı`,
    hasErrors: errors > 0
  };
}

// Run ESLint for linting
export async function runESLintDiagnostics(rootDir: string): Promise<DiagnosticsResult> {
  const diagnostics: Diagnostic[] = [];
  const resolved = path.resolve(rootDir);
  
  // Check if eslint config exists
  const eslintConfigs = [".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"];
  const hasEslint = eslintConfigs.some(c => fs.existsSync(path.join(resolved, c)));
  
  if (!hasEslint) {
    return { diagnostics: [], summary: "⚠️ ESLint config bulunamadı", hasErrors: false };
  }

  try {
    const { stdout } = await execAsync("npx eslint . --format json 2>&1", { 
      cwd: resolved, 
      timeout: 60000,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash"
    });
    
    const results = JSON.parse(stdout);
    for (const result of results) {
      for (const msg of result.messages || []) {
        diagnostics.push({
          file: path.relative(resolved, result.filePath),
          line: msg.line || 1,
          column: msg.column || 1,
          severity: msg.severity === 2 ? "error" : "warning",
          message: msg.message,
          code: msg.ruleId,
          source: "eslint"
        });
      }
    }
  } catch (error: any) {
    // ESLint might exit with error code if there are issues
    try {
      const output = error.stdout || "";
      if (output.startsWith("[")) {
        const results = JSON.parse(output);
        for (const result of results) {
          for (const msg of result.messages || []) {
            diagnostics.push({
              file: path.relative(resolved, result.filePath),
              line: msg.line || 1,
              column: msg.column || 1,
              severity: msg.severity === 2 ? "error" : "warning",
              message: msg.message,
              code: msg.ruleId,
              source: "eslint"
            });
          }
        }
      }
    } catch {}
  }

  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.filter(d => d.severity === "warning").length;
  
  return {
    diagnostics,
    summary: `🔍 ESLint: ${errors} hata, ${warnings} uyarı`,
    hasErrors: errors > 0
  };
}

// Simple syntax check for files without tooling
export function checkSyntax(filePath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ext = path.extname(filePath);
  
  if (![".ts", ".tsx", ".js", ".jsx", ".json"].includes(ext)) {
    return diagnostics;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    
    if (ext === ".json") {
      try {
        JSON.parse(content);
      } catch (e: any) {
        const match = e.message.match(/position (\d+)/);
        const pos = match ? parseInt(match[1]) : 0;
        const lines = content.slice(0, pos).split("\n");
        diagnostics.push({
          file: filePath,
          line: lines.length,
          column: lines[lines.length - 1]?.length || 1,
          severity: "error",
          message: e.message,
          source: "json"
        });
      }
      return diagnostics;
    }

    // Basic bracket matching
    const brackets: { char: string; line: number; col: number }[] = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closing: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    
    const lines = content.split("\n");
    let inString = false;
    let stringChar = "";
    let inComment = false;
    let inMultiComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prev = j > 0 ? line[j - 1] : "";
        const next = j < line.length - 1 ? line[j + 1] : "";

        // Handle strings
        if ((char === '"' || char === "'" || char === "`") && prev !== "\\") {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }
        if (inString) continue;

        // Handle comments
        if (char === "/" && next === "/") { inComment = true; continue; }
        if (char === "/" && next === "*") { inMultiComment = true; continue; }
        if (char === "*" && next === "/" && inMultiComment) { inMultiComment = false; j++; continue; }
        if (inComment || inMultiComment) continue;

        // Track brackets
        if (pairs[char]) {
          brackets.push({ char, line: i + 1, col: j + 1 });
        } else if (closing[char]) {
          const last = brackets.pop();
          if (!last || last.char !== closing[char]) {
            diagnostics.push({
              file: filePath,
              line: i + 1,
              column: j + 1,
              severity: "error",
              message: `Eşleşmeyen parantez: '${char}'`,
              source: "syntax"
            });
          }
        }
      }
      inComment = false;
    }

    // Check unclosed brackets
    for (const b of brackets) {
      diagnostics.push({
        file: filePath,
        line: b.line,
        column: b.col,
        severity: "error",
        message: `Kapatılmamış parantez: '${b.char}'`,
        source: "syntax"
      });
    }

  } catch {}

  return diagnostics;
}

// Run all diagnostics
export async function runAllDiagnostics(rootDir: string): Promise<DiagnosticsResult> {
  const allDiagnostics: Diagnostic[] = [];
  const summaries: string[] = [];

  // TypeScript
  const tsResult = await runTypeScriptDiagnostics(rootDir);
  allDiagnostics.push(...tsResult.diagnostics);
  summaries.push(tsResult.summary);

  // ESLint
  const eslintResult = await runESLintDiagnostics(rootDir);
  allDiagnostics.push(...eslintResult.diagnostics);
  summaries.push(eslintResult.summary);

  const errors = allDiagnostics.filter(d => d.severity === "error").length;
  const warnings = allDiagnostics.filter(d => d.severity === "warning").length;

  return {
    diagnostics: allDiagnostics,
    summary: `📋 Diagnostics:\n${summaries.join("\n")}\n\n📊 Toplam: ${errors} hata, ${warnings} uyarı`,
    hasErrors: errors > 0
  };
}

// Format diagnostics for display
export function formatDiagnostics(result: DiagnosticsResult): string {
  if (result.diagnostics.length === 0) {
    return result.summary;
  }

  let output = result.summary + "\n\n";
  
  // Group by file
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of result.diagnostics) {
    const existing = byFile.get(d.file) || [];
    existing.push(d);
    byFile.set(d.file, existing);
  }

  for (const [file, diags] of byFile) {
    output += `📄 ${file}\n`;
    for (const d of diags.slice(0, 10)) {
      const icon = d.severity === "error" ? "❌" : "⚠️";
      output += `  ${icon} ${d.line}:${d.column} ${d.message}`;
      if (d.code) output += ` [${d.code}]`;
      output += "\n";
    }
    if (diags.length > 10) {
      output += `  ... ve ${diags.length - 10} daha\n`;
    }
  }

  return output;
}
