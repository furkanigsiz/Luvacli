/**
 * Dependency Graph - Import chain tracking
 *
 * Bir dosyanın tüm bağımlılıklarını bulur
 * Cursor/Kiro tarzı dependency-aware context
 */
import * as fs from "fs";
import * as path from "path";
/**
 * Extract imports from a file
 */
function extractImports(filePath, rootDir) {
    const imports = [];
    if (!fs.existsSync(filePath))
        return imports;
    const content = fs.readFileSync(filePath, "utf-8");
    const dir = path.dirname(filePath);
    // ES6 imports: import x from './file'
    const es6Regex = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = es6Regex.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveImportPath(importPath, dir, rootDir);
        if (resolved)
            imports.push(resolved);
    }
    // CommonJS: require('./file')
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = cjsRegex.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveImportPath(importPath, dir, rootDir);
        if (resolved)
            imports.push(resolved);
    }
    // Dynamic imports: import('./file')
    const dynamicRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicRegex.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = resolveImportPath(importPath, dir, rootDir);
        if (resolved)
            imports.push(resolved);
    }
    return [...new Set(imports)]; // Remove duplicates
}
/**
 * Resolve import path to actual file
 */
function resolveImportPath(importPath, fromDir, rootDir) {
    // Skip node_modules and external packages
    if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
        return null;
    }
    const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
    const basePath = path.resolve(fromDir, importPath);
    // Try with extensions
    for (const ext of extensions) {
        const fullPath = basePath + ext;
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            return path.relative(rootDir, fullPath);
        }
    }
    // Try index files
    for (const ext of extensions) {
        const indexPath = path.join(basePath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
            return path.relative(rootDir, indexPath);
        }
    }
    return null;
}
/**
 * Build dependency graph for codebase
 */
export function buildDependencyGraph(rootDir) {
    const nodes = new Map();
    const extensions = [".ts", ".tsx", ".js", ".jsx"];
    const ignoreDirs = ["node_modules", ".git", "dist", "build", ".next"];
    // First pass: collect all files and their imports
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith(".")) {
                        walkDir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (extensions.includes(ext)) {
                        const relPath = path.relative(rootDir, fullPath);
                        const imports = extractImports(fullPath, rootDir);
                        nodes.set(relPath, {
                            file: relPath,
                            imports,
                            importedBy: [],
                            depth: -1
                        });
                    }
                }
            }
        }
        catch { }
    }
    walkDir(rootDir);
    // Second pass: build reverse dependencies (importedBy)
    for (const [file, node] of nodes) {
        for (const imp of node.imports) {
            const importedNode = nodes.get(imp);
            if (importedNode) {
                importedNode.importedBy.push(file);
            }
        }
    }
    return { nodes, rootDir };
}
/**
 * Get all dependencies of a file (recursive)
 */
export function getDependencies(graph, file, maxDepth = 3) {
    const visited = new Set();
    const result = [];
    function traverse(currentFile, depth) {
        if (depth > maxDepth || visited.has(currentFile))
            return;
        visited.add(currentFile);
        const node = graph.nodes.get(currentFile);
        if (!node)
            return;
        for (const imp of node.imports) {
            if (!visited.has(imp)) {
                result.push(imp);
                traverse(imp, depth + 1);
            }
        }
    }
    traverse(file, 0);
    return result;
}
/**
 * Get all files that depend on a file (reverse dependencies)
 */
export function getDependents(graph, file, maxDepth = 2) {
    const visited = new Set();
    const result = [];
    function traverse(currentFile, depth) {
        if (depth > maxDepth || visited.has(currentFile))
            return;
        visited.add(currentFile);
        const node = graph.nodes.get(currentFile);
        if (!node)
            return;
        for (const dep of node.importedBy) {
            if (!visited.has(dep)) {
                result.push(dep);
                traverse(dep, depth + 1);
            }
        }
    }
    traverse(file, 0);
    return result;
}
/**
 * Get related files (both dependencies and dependents)
 */
export function getRelatedFiles(graph, file) {
    return {
        dependencies: getDependencies(graph, file),
        dependents: getDependents(graph, file)
    };
}
/**
 * Format dependency info for display
 */
export function formatDependencyInfo(graph, file) {
    const node = graph.nodes.get(file);
    if (!node)
        return `❌ Dosya bulunamadı: ${file}`;
    let output = `📄 ${file}\n\n`;
    output += `📥 Imports (${node.imports.length}):\n`;
    for (const imp of node.imports.slice(0, 10)) {
        output += `  → ${imp}\n`;
    }
    if (node.imports.length > 10) {
        output += `  ... ve ${node.imports.length - 10} daha\n`;
    }
    output += `\n📤 Imported by (${node.importedBy.length}):\n`;
    for (const dep of node.importedBy.slice(0, 10)) {
        output += `  ← ${dep}\n`;
    }
    if (node.importedBy.length > 10) {
        output += `  ... ve ${node.importedBy.length - 10} daha\n`;
    }
    return output;
}
/**
 * Get graph summary
 */
export function getGraphSummary(graph) {
    const totalFiles = graph.nodes.size;
    let totalImports = 0;
    let maxImports = 0;
    let maxImportsFile = "";
    for (const [file, node] of graph.nodes) {
        totalImports += node.imports.length;
        if (node.imports.length > maxImports) {
            maxImports = node.imports.length;
            maxImportsFile = file;
        }
    }
    return `🔗 Dependency Graph: ${totalFiles} dosya, ${totalImports} import\n` +
        `   En çok import: ${maxImportsFile} (${maxImports})`;
}
