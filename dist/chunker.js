/**
 * Smart Chunker - AST-based code chunking
 *
 * Dosyaları fonksiyon/class/interface bazında parçalar
 * Regex-based parsing (tree-sitter ileride eklenecek)
 */
import * as fs from "fs";
import * as path from "path";
/**
 * Simple hash for content change detection
 */
function hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}
/**
 * Parse file into chunks using regex
 */
function parseWithRegex(filePath, content) {
    const chunks = [];
    const lines = content.split("\n");
    // Extract imports
    const importLines = [];
    let importEnd = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("import ") || line.startsWith("from ") ||
            (line.startsWith("const ") && line.includes("require("))) {
            importLines.push(lines[i]);
            importEnd = i;
        }
        else if (importLines.length > 0 && line === "") {
            continue;
        }
        else if (importLines.length > 0) {
            break;
        }
    }
    if (importLines.length > 0) {
        const importContent = importLines.join("\n");
        chunks.push({
            file: filePath, startLine: 1, endLine: importEnd + 1,
            content: importContent, type: "import", hash: hashContent(importContent)
        });
    }
    const patterns = [
        { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, type: "function" },
        { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/m, type: "function" },
        { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/m, type: "function" },
        { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m, type: "class" },
        { regex: /^(?:export\s+)?interface\s+(\w+)/m, type: "interface" },
        { regex: /^(?:export\s+)?type\s+(\w+)/m, type: "interface" },
        { regex: /^(?:async\s+)?def\s+(\w+)/m, type: "function" },
        { regex: /^class\s+(\w+)/m, type: "class" },
    ];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { regex, type } of patterns) {
            const match = line.match(regex);
            if (match) {
                const name = match[1];
                const startLine = i + 1;
                const endLine = findBlockEnd(lines, i);
                const exists = chunks.some(c => c.startLine === startLine && c.name === name);
                if (!exists && endLine > startLine) {
                    const nodeContent = lines.slice(startLine - 1, endLine).join("\n");
                    chunks.push({
                        file: filePath, startLine, endLine, content: nodeContent,
                        type, name, hash: hashContent(nodeContent)
                    });
                }
                break;
            }
        }
    }
    return chunks;
}
/**
 * Find end of code block
 */
function findBlockEnd(lines, startIndex) {
    let braceCount = 0;
    let started = false;
    let inString = false;
    let stringChar = "";
    const startLine = lines[startIndex];
    const startIndent = startLine.search(/\S/);
    const isPython = startLine.includes("def ") || startLine.includes("class ");
    if (isPython) {
        for (let i = startIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === "")
                continue;
            const indent = line.search(/\S/);
            if (indent <= startIndent && line.trim() !== "")
                return i;
        }
        return lines.length;
    }
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const prev = j > 0 ? line[j - 1] : "";
            if ((char === '"' || char === "'" || char === "`") && prev !== "\\") {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                }
                else if (char === stringChar) {
                    inString = false;
                }
                continue;
            }
            if (inString)
                continue;
            if (char === "{") {
                braceCount++;
                started = true;
            }
            else if (char === "}") {
                braceCount--;
                if (started && braceCount === 0)
                    return i + 1;
            }
        }
    }
    return Math.min(startIndex + 50, lines.length);
}
/**
 * Parse file into chunks (main entry point)
 */
export async function parseFileIntoChunks(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);
    const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"];
    if (!codeExtensions.includes(ext)) {
        if (content.length < 5000) {
            return [{
                    file: filePath, startLine: 1, endLine: content.split("\n").length,
                    content, type: "other", hash: hashContent(content)
                }];
        }
        return [];
    }
    return parseWithRegex(filePath, content);
}
/**
 * Synchronous version for backward compatibility
 */
export function parseFileIntoChunksSync(filePath) {
    if (!fs.existsSync(filePath))
        return [];
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath);
    const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"];
    if (!codeExtensions.includes(ext)) {
        if (content.length < 5000) {
            return [{
                    file: filePath, startLine: 1, endLine: content.split("\n").length,
                    content, type: "other", hash: hashContent(content)
                }];
        }
        return [];
    }
    return parseWithRegex(filePath, content);
}
/**
 * Chunk entire codebase
 */
export async function chunkCodebase(rootDir) {
    const allChunks = [];
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".md", ".json"];
    const ignoreDirs = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".luva"];
    async function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith(".")) {
                        await walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (extensions.includes(ext)) {
                        const chunks = await parseFileIntoChunks(fullPath);
                        allChunks.push(...chunks);
                    }
                }
            }
        }
        catch { }
    }
    await walkDir(rootDir);
    return allChunks;
}
/**
 * Get chunk summary
 */
export function getChunkSummary(chunks) {
    const byType = new Map();
    const byFile = new Map();
    for (const chunk of chunks) {
        byType.set(chunk.type, (byType.get(chunk.type) || 0) + 1);
        byFile.set(chunk.file, (byFile.get(chunk.file) || 0) + 1);
    }
    let summary = `📦 ${chunks.length} chunk, ${byFile.size} dosya\n`;
    summary += `   ƒ ${byType.get("function") || 0} fonksiyon`;
    summary += ` | C ${byType.get("class") || 0} class`;
    summary += ` | I ${byType.get("interface") || 0} interface`;
    return summary;
}
