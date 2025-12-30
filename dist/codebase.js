import * as fs from "fs";
import * as path from "path";
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__", ".venv", "venv"];
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".cs", ".cpp", ".c", ".h"];
// Index the entire codebase
export async function indexCodebase(rootDir) {
    const resolved = path.resolve(rootDir);
    const files = [];
    const symbols = new Map();
    // Scan files
    scanDirectory(resolved, resolved, files, symbols);
    // Load package.json if exists
    let dependencies = {};
    let devDependencies = {};
    const pkgPath = path.join(resolved, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            dependencies = pkg.dependencies || {};
            devDependencies = pkg.devDependencies || {};
        }
        catch { }
    }
    const summary = generateSummary(files, symbols, dependencies);
    return { root: resolved, files, symbols, dependencies, devDependencies, summary };
}
function scanDirectory(dir, root, files, symbols) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        if (item.name.startsWith(".") || IGNORE_DIRS.includes(item.name))
            continue;
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(root, fullPath);
        if (item.isDirectory()) {
            files.push({ path: fullPath, relativePath, type: "directory" });
            scanDirectory(fullPath, root, files, symbols);
        }
        else {
            const ext = path.extname(item.name);
            const stat = fs.statSync(fullPath);
            const fileInfo = {
                path: fullPath,
                relativePath,
                type: "file",
                extension: ext,
                size: stat.size
            };
            // Extract symbols from code files
            if (CODE_EXTENSIONS.includes(ext)) {
                const fileSymbols = extractSymbols(fullPath, ext);
                if (fileSymbols.length > 0) {
                    fileInfo.symbols = fileSymbols;
                    symbols.set(relativePath, fileSymbols);
                }
            }
            files.push(fileInfo);
        }
    }
}
function extractSymbols(filePath, ext) {
    const symbols = [];
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
            extractJSSymbols(lines, symbols);
        }
        else if (ext === ".py") {
            extractPythonSymbols(lines, symbols);
        }
    }
    catch { }
    return symbols;
}
function extractJSSymbols(lines, symbols) {
    const patterns = [
        { regex: /^export\s+(async\s+)?function\s+(\w+)/, kind: "function", exported: true },
        { regex: /^export\s+(const|let|var)\s+(\w+)/, kind: "variable", exported: true },
        { regex: /^export\s+(class)\s+(\w+)/, kind: "class", exported: true },
        { regex: /^export\s+(interface)\s+(\w+)/, kind: "interface", exported: true },
        { regex: /^export\s+(type)\s+(\w+)/, kind: "type", exported: true },
        { regex: /^(async\s+)?function\s+(\w+)/, kind: "function", exported: false },
        { regex: /^(const|let|var)\s+(\w+)\s*=/, kind: "variable", exported: false },
        { regex: /^class\s+(\w+)/, kind: "class", exported: false },
        { regex: /^interface\s+(\w+)/, kind: "interface", exported: false },
        { regex: /^type\s+(\w+)/, kind: "type", exported: false },
        { regex: /^import\s+.*from\s+['"](.+)['"]/, kind: "import", exported: false },
    ];
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        for (const { regex, kind, exported } of patterns) {
            const match = trimmed.match(regex);
            if (match) {
                const name = kind === "import" ? match[1] : (match[2] || match[1]);
                symbols.push({ name, kind, line: i + 1, exported });
                break;
            }
        }
    });
}
function extractPythonSymbols(lines, symbols) {
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Functions
        const funcMatch = trimmed.match(/^(async\s+)?def\s+(\w+)/);
        if (funcMatch) {
            symbols.push({ name: funcMatch[2], kind: "function", line: i + 1, exported: !funcMatch[2].startsWith("_") });
        }
        // Classes
        const classMatch = trimmed.match(/^class\s+(\w+)/);
        if (classMatch) {
            symbols.push({ name: classMatch[1], kind: "class", line: i + 1, exported: !classMatch[1].startsWith("_") });
        }
        // Imports
        const importMatch = trimmed.match(/^(from\s+\S+\s+)?import\s+(.+)/);
        if (importMatch) {
            symbols.push({ name: importMatch[2].split(",")[0].trim(), kind: "import", line: i + 1, exported: false });
        }
    });
}
function generateSummary(files, symbols, deps) {
    const codeFiles = files.filter(f => f.type === "file" && f.extension && CODE_EXTENSIONS.includes(f.extension));
    const totalSymbols = Array.from(symbols.values()).flat();
    const functions = totalSymbols.filter(s => s.kind === "function");
    const classes = totalSymbols.filter(s => s.kind === "class");
    const interfaces = totalSymbols.filter(s => s.kind === "interface");
    const extCounts = {};
    codeFiles.forEach(f => {
        const ext = f.extension || "other";
        extCounts[ext] = (extCounts[ext] || 0) + 1;
    });
    let summary = `📊 Codebase Summary:\n`;
    summary += `├── Files: ${files.filter(f => f.type === "file").length}\n`;
    summary += `├── Directories: ${files.filter(f => f.type === "directory").length}\n`;
    summary += `├── Code files: ${codeFiles.length}\n`;
    summary += `├── Functions: ${functions.length}\n`;
    summary += `├── Classes: ${classes.length}\n`;
    summary += `├── Interfaces: ${interfaces.length}\n`;
    summary += `├── Dependencies: ${Object.keys(deps).length}\n`;
    summary += `└── Languages: ${Object.entries(extCounts).map(([k, v]) => `${k}(${v})`).join(", ")}\n`;
    return summary;
}
// Search symbols across codebase
export function searchSymbols(index, query) {
    const results = [];
    const lower = query.toLowerCase();
    for (const [file, symbols] of index.symbols) {
        for (const symbol of symbols) {
            if (symbol.name.toLowerCase().includes(lower)) {
                results.push({ file, symbol });
            }
        }
    }
    return results.slice(0, 50);
}
// Find references to a symbol
export function findReferences(index, symbolName) {
    const refs = [];
    for (const file of index.files) {
        if (file.type !== "file" || !file.extension || !CODE_EXTENSIONS.includes(file.extension))
            continue;
        try {
            const content = fs.readFileSync(file.path, "utf-8");
            if (content.includes(symbolName)) {
                const lines = content.split("\n");
                lines.forEach((line, i) => {
                    if (line.includes(symbolName)) {
                        refs.push(`${file.relativePath}:${i + 1}: ${line.trim().slice(0, 100)}`);
                    }
                });
            }
        }
        catch { }
    }
    return refs.slice(0, 30);
}
// Get file context (imports, exports, dependencies)
export function getFileContext(index, filePath) {
    const relativePath = path.relative(index.root, path.resolve(filePath));
    const symbols = index.symbols.get(relativePath) || [];
    const imports = symbols.filter(s => s.kind === "import");
    const exports = symbols.filter(s => s.exported);
    let context = `📄 ${relativePath}\n`;
    if (imports.length > 0) {
        context += `\n📥 Imports:\n${imports.map(i => `  • ${i.name}`).join("\n")}\n`;
    }
    if (exports.length > 0) {
        context += `\n📤 Exports:\n${exports.map(e => `  • ${e.kind}: ${e.name} (line ${e.line})`).join("\n")}\n`;
    }
    return context;
}
