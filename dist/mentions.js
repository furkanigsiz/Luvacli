import * as fs from "fs";
import * as path from "path";
// Parse @ mentions from message
export function parseMentions(message, cwd) {
    const mentions = [];
    let cleanMessage = message;
    // @file:path/to/file.ts - Include specific file
    const fileRegex = /@file:([^\s]+)/g;
    let match;
    while ((match = fileRegex.exec(message)) !== null) {
        const filePath = path.resolve(cwd, match[1]);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                mentions.push({ type: "file", value: match[1], content });
            }
            catch { }
        }
        cleanMessage = cleanMessage.replace(match[0], "");
    }
    // @folder:path/to/folder - Include folder structure + files
    const folderRegex = /@folder:([^\s]+)/g;
    while ((match = folderRegex.exec(message)) !== null) {
        const folderPath = path.resolve(cwd, match[1]);
        if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
            const content = getFolderContent(folderPath, cwd);
            mentions.push({ type: "folder", value: match[1], content });
        }
        cleanMessage = cleanMessage.replace(match[0], "");
    }
    // @web:query - Web search
    const webRegex = /@web:([^\s]+(?:\s+[^\s@]+)*)/g;
    while ((match = webRegex.exec(message)) !== null) {
        mentions.push({ type: "web", value: match[1] });
        cleanMessage = cleanMessage.replace(match[0], "");
    }
    // @symbol:functionName - Find symbol in codebase
    const symbolRegex = /@symbol:([^\s]+)/g;
    while ((match = symbolRegex.exec(message)) !== null) {
        mentions.push({ type: "symbol", value: match[1] });
        cleanMessage = cleanMessage.replace(match[0], "");
    }
    // @git - Include git status/diff
    const gitRegex = /@git\b/g;
    if (gitRegex.test(message)) {
        mentions.push({ type: "git", value: "status" });
        cleanMessage = cleanMessage.replace(/@git\b/g, "");
    }
    // @git:diff - Include git diff
    const gitDiffRegex = /@git:diff/g;
    if (gitDiffRegex.test(message)) {
        mentions.push({ type: "git", value: "diff" });
        cleanMessage = cleanMessage.replace(/@git:diff/g, "");
    }
    return { cleanMessage: cleanMessage.trim(), mentions };
}
// Get folder content recursively
function getFolderContent(folderPath, cwd, depth = 0, maxDepth = 2) {
    if (depth > maxDepth)
        return "";
    const IGNORE = ["node_modules", ".git", "dist", "build", ".next", "__pycache__"];
    const CODE_EXT = [".ts", ".tsx", ".js", ".jsx", ".py", ".json", ".md", ".css", ".html"];
    let content = "";
    const items = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const item of items) {
        if (item.name.startsWith(".") || IGNORE.includes(item.name))
            continue;
        const fullPath = path.join(folderPath, item.name);
        const relativePath = path.relative(cwd, fullPath);
        if (item.isDirectory()) {
            content += `\n📁 ${relativePath}/\n`;
            content += getFolderContent(fullPath, cwd, depth + 1, maxDepth);
        }
        else if (CODE_EXT.some(ext => item.name.endsWith(ext))) {
            try {
                const fileContent = fs.readFileSync(fullPath, "utf-8");
                if (fileContent.length < 10000) { // Skip large files
                    content += `\n--- ${relativePath} ---\n\`\`\`\n${fileContent}\n\`\`\`\n`;
                }
                else {
                    content += `\n--- ${relativePath} (${Math.round(fileContent.length / 1000)}KB, truncated) ---\n`;
                    content += `\`\`\`\n${fileContent.slice(0, 3000)}\n... [truncated]\n\`\`\`\n`;
                }
            }
            catch { }
        }
    }
    return content;
}
// Build context from mentions
export async function buildMentionContext(mentions, cwd) {
    if (mentions.length === 0)
        return "";
    let context = "\n\n=== MENTIONED CONTEXT ===\n";
    for (const mention of mentions) {
        switch (mention.type) {
            case "file":
                context += `\n📄 @file:${mention.value}\n\`\`\`\n${mention.content}\n\`\`\`\n`;
                break;
            case "folder":
                context += `\n📁 @folder:${mention.value}\n${mention.content}\n`;
                break;
            case "web":
                context += `\n🌐 @web:${mention.value}\n[Web search will be performed]\n`;
                break;
            case "symbol":
                context += `\n🔍 @symbol:${mention.value}\n[Symbol search requested]\n`;
                break;
            case "git":
                context += await getGitContext(cwd, mention.value);
                break;
        }
    }
    return context;
}
// Get git context
async function getGitContext(cwd, type) {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    try {
        if (type === "diff") {
            const { stdout } = await execAsync("git diff", { cwd });
            return `\n📊 @git:diff\n\`\`\`diff\n${stdout.slice(0, 5000)}\n\`\`\`\n`;
        }
        else {
            const { stdout: branch } = await execAsync("git branch --show-current", { cwd });
            const { stdout: status } = await execAsync("git status --short", { cwd });
            return `\n🌿 @git\nBranch: ${branch.trim()}\n\`\`\`\n${status}\n\`\`\`\n`;
        }
    }
    catch {
        return "\n⚠️ Git bilgisi alınamadı\n";
    }
}
// Format mentions for display
export function formatMentions(mentions) {
    if (mentions.length === 0)
        return "";
    const icons = {
        file: "📄",
        folder: "📁",
        web: "🌐",
        symbol: "🔍",
        git: "🌿"
    };
    return mentions.map(m => `${icons[m.type]} ${m.type}:${m.value}`).join(" | ");
}
