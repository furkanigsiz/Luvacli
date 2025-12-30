/**
 * Steering System - Kiro-style project rules and context
 *
 * Reads .luva/steering/*.md files and injects them into system prompt
 * Supports: always, fileMatch, manual inclusion modes
 */
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
const STEERING_DIR = ".luva/steering";
/**
 * Parse frontmatter from markdown file
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content };
    }
    try {
        const frontmatter = yaml.parse(match[1]);
        return { frontmatter, body: match[2].trim() };
    }
    catch {
        return { frontmatter: {}, body: content };
    }
}
/**
 * Discover all steering files in project
 */
export function discoverSteeringFiles(cwd) {
    const steeringDir = path.join(cwd, STEERING_DIR);
    if (!fs.existsSync(steeringDir)) {
        return [];
    }
    const files = [];
    try {
        const entries = fs.readdirSync(steeringDir);
        for (const entry of entries) {
            if (!entry.endsWith(".md"))
                continue;
            const filePath = path.join(steeringDir, entry);
            const stat = fs.statSync(filePath);
            if (!stat.isFile())
                continue;
            const content = fs.readFileSync(filePath, "utf-8");
            const { frontmatter, body } = parseFrontmatter(content);
            files.push({
                name: entry.replace(".md", ""),
                path: filePath,
                content: body,
                inclusion: frontmatter.inclusion || "always",
                fileMatchPattern: frontmatter.fileMatchPattern,
                description: frontmatter.description
            });
        }
    }
    catch (e) {
        // Ignore errors
    }
    return files;
}
/**
 * Check if a file matches a glob pattern (simple implementation)
 */
function matchesPattern(filePath, pattern) {
    // Simple glob matching: * = any chars, ** = any path
    const regexPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "{{DOUBLESTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/{{DOUBLESTAR}}/g, ".*");
    const regex = new RegExp(`^${regexPattern}$`, "i");
    return regex.test(filePath) || regex.test(path.basename(filePath));
}
/**
 * Get steering files that should be included based on context
 */
export function getActiveSteeringFiles(cwd, activeFiles = [], manualIncludes = []) {
    const allFiles = discoverSteeringFiles(cwd);
    const active = [];
    for (const file of allFiles) {
        // Always include
        if (file.inclusion === "always") {
            active.push(file);
            continue;
        }
        // File match - check if any active file matches pattern
        if (file.inclusion === "fileMatch" && file.fileMatchPattern) {
            const matches = activeFiles.some(f => matchesPattern(f, file.fileMatchPattern));
            if (matches) {
                active.push(file);
            }
            continue;
        }
        // Manual - check if explicitly included
        if (file.inclusion === "manual") {
            if (manualIncludes.includes(file.name) || manualIncludes.includes(`#${file.name}`)) {
                active.push(file);
            }
        }
    }
    return active;
}
/**
 * Build steering context string for system prompt
 */
export function buildSteeringContext(files) {
    if (files.length === 0)
        return "";
    let context = "\n\n## Steering Rules\n";
    context += "The following project-specific rules and guidelines apply:\n\n";
    for (const file of files) {
        context += `### ${file.name}\n`;
        if (file.description) {
            context += `*${file.description}*\n\n`;
        }
        context += `${file.content}\n\n`;
    }
    return context;
}
/**
 * List available steering files for user
 */
export function listSteeringFiles(cwd) {
    const files = discoverSteeringFiles(cwd);
    if (files.length === 0) {
        return `📋 Steering dosyası yok.

Oluşturmak için:
  mkdir -p .luva/steering
  echo "# Proje Kuralları" > .luva/steering/rules.md`;
    }
    let output = "📋 Steering Dosyaları:\n\n";
    for (const file of files) {
        const icon = file.inclusion === "always" ? "🟢" :
            file.inclusion === "fileMatch" ? "🟡" : "⚪";
        output += `  ${icon} ${file.name} [${file.inclusion}]`;
        if (file.fileMatchPattern) {
            output += ` → ${file.fileMatchPattern}`;
        }
        output += "\n";
    }
    output += "\n🟢 always | 🟡 fileMatch | ⚪ manual (#name ile kullan)";
    return output;
}
/**
 * Create a new steering file
 */
export function createSteeringFile(cwd, name, content, options = {}) {
    const steeringDir = path.join(cwd, STEERING_DIR);
    // Create directory if not exists
    if (!fs.existsSync(steeringDir)) {
        fs.mkdirSync(steeringDir, { recursive: true });
    }
    const fileName = name.endsWith(".md") ? name : `${name}.md`;
    const filePath = path.join(steeringDir, fileName);
    // Build frontmatter
    let fileContent = "---\n";
    fileContent += `inclusion: ${options.inclusion || "always"}\n`;
    if (options.fileMatchPattern) {
        fileContent += `fileMatchPattern: "${options.fileMatchPattern}"\n`;
    }
    if (options.description) {
        fileContent += `description: "${options.description}"\n`;
    }
    fileContent += "---\n\n";
    fileContent += content;
    fs.writeFileSync(filePath, fileContent);
    return filePath;
}
/**
 * Parse #steering mentions from message
 */
export function parseSteeringMentions(message) {
    const mentions = [];
    const cleanMessage = message.replace(/#([a-zA-Z0-9_-]+)/g, (match, name) => {
        mentions.push(name);
        return "";
    }).trim();
    return { cleanMessage, mentions };
}
