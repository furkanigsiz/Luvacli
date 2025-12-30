import * as fs from "fs";
import * as path from "path";
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const LUVA_SKILLS_DIR = path.join(HOME, ".config", "luva", "skills");
// Discover all skills in the Skills directory
export function discoverSkills() {
    if (!fs.existsSync(LUVA_SKILLS_DIR))
        return [];
    const skills = [];
    const dirs = fs.readdirSync(LUVA_SKILLS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
        if (!dir.isDirectory())
            continue;
        const skillPath = path.join(LUVA_SKILLS_DIR, dir.name);
        const skillFile = path.join(skillPath, "SKILL.md");
        if (fs.existsSync(skillFile)) {
            const skill = parseSkillFile(skillFile, dir.name, skillPath);
            if (skill)
                skills.push(skill);
        }
    }
    return skills;
}
// Parse a SKILL.md file
function parseSkillFile(filePath, name, skillPath) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        // Extract frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let description = "";
        let triggers = [];
        let inclusion = "auto"; // default to auto
        let customTriggers = [];
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            const descMatch = frontmatter.match(/description:\s*(.+)/);
            if (descMatch)
                description = descMatch[1].trim();
            // Extract inclusion mode
            const inclusionMatch = frontmatter.match(/inclusion:\s*(\w+)/);
            if (inclusionMatch) {
                const mode = inclusionMatch[1].toLowerCase();
                if (mode === "manual") {
                    inclusion = "manual";
                }
                else if (mode === "filematch") {
                    inclusion = "fileMatch";
                }
                else if (mode === "always") {
                    inclusion = "always";
                }
            }
            // Extract custom triggers from frontmatter (comma-separated)
            const triggersMatch = frontmatter.match(/triggers:\s*(.+)/);
            if (triggersMatch) {
                customTriggers = triggersMatch[1].split(",").map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
            }
            // Extract trigger keywords from description
            triggers = extractTriggers(description);
        }
        // Also extract triggers from full content for better matching
        const contentTriggers = extractTriggers(content);
        // Combine all triggers: custom > content > description
        // Custom triggers get priority (added first)
        triggers = [...new Set([...customTriggers, ...triggers, ...contentTriggers])];
        // Extract workflows from table
        const workflows = extractWorkflows(content, skillPath);
        return {
            name,
            description,
            triggers,
            workflows,
            context: content,
            path: skillPath,
            inclusion
        };
    }
    catch {
        return null;
    }
}
// Extract trigger keywords from skill description
function extractTriggers(description) {
    const lower = description.toLowerCase();
    const triggers = [];
    // Common trigger patterns
    const patterns = {
        "research": ["araştır", "research", "investigate", "analiz", "analyze"],
        "art": ["görsel", "image", "resim", "art", "visual", "çiz", "draw"],
        "code": ["kod", "code", "program", "geliştir", "develop"],
        "write": ["yaz", "write", "document", "döküman"],
        "identity": ["kimlik", "identity", "personality", "kişilik"],
        "contact": ["kişi", "contact", "iletişim"],
        "frontend": [
            // Turkish
            "frontend", "front-end", "ui", "arayüz", "tasarla", "tasarım", "sayfa", "bileşen",
            "stil", "renk", "font", "yazı tipi", "hover", "animasyon", "efekt", "buton",
            "kart", "kutucuk", "menü", "navbar", "footer", "header", "hero", "section",
            // English
            "interface", "design", "page", "landing", "component", "web", "site", "website",
            "react", "tailwind", "css", "html", "style", "color", "button", "card", "box",
            "menu", "navigation", "layout", "grid", "flex", "responsive", "mobile",
            "animation", "transition", "effect", "typography", "spacing", "margin", "padding"
        ],
        "backend": ["backend", "back-end", "api", "server", "sunucu", "database", "veritabanı", "endpoint"],
        "mobile": ["mobile", "mobil", "app", "uygulama", "ios", "android", "react native", "flutter"]
    };
    for (const [key, keywords] of Object.entries(patterns)) {
        if (keywords.some(k => lower.includes(k))) {
            triggers.push(...keywords);
        }
    }
    return [...new Set(triggers)];
}
// Extract workflows from SKILL.md content
function extractWorkflows(content, skillPath) {
    const workflows = [];
    // Match workflow table rows - more flexible regex
    // | **Name** | "trigger" | `file.md` | or | **Name** | "trigger" | Workflows/file.md |
    const tableRegex = /\|\s*\*\*(\w+)\*\*\s*\|\s*"([^"]+)"\s*\|\s*`?([^`|\s]+)`?\s*\|/g;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
        const workflowFile = path.join(skillPath, match[3]);
        let workflowContent = "";
        if (fs.existsSync(workflowFile)) {
            workflowContent = fs.readFileSync(workflowFile, "utf-8");
        }
        workflows.push({
            name: match[1],
            trigger: match[2],
            file: match[3],
            content: workflowContent
        });
    }
    return workflows;
}
// Find matching skills for a user message (can return multiple)
// ignoreInclusion: true for agent mode - match even manual skills
export function matchSkills(message, skills, ignoreInclusion = false, maxSkills = 3) {
    const lower = message.toLowerCase();
    const scored = [];
    for (const skill of skills) {
        // Skip manual skills unless ignoreInclusion is true
        if (!ignoreInclusion && skill.inclusion === "manual") {
            continue;
        }
        let score = 0;
        // Check triggers - custom triggers from frontmatter get highest weight
        for (const trigger of skill.triggers) {
            if (lower.includes(trigger.toLowerCase())) {
                // Exact word match gets more points
                const wordBoundary = new RegExp(`\\b${trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
                if (wordBoundary.test(lower)) {
                    score += 15; // Exact word match
                }
                else {
                    score += 8; // Partial match
                }
            }
        }
        // Check skill name (partial match)
        const skillNameParts = skill.name.toLowerCase().split(/[-_]/);
        for (const part of skillNameParts) {
            if (part.length > 2 && lower.includes(part)) {
                score += 10;
            }
        }
        // Check description keywords (lower weight)
        const descWords = skill.description.toLowerCase().split(/\s+/);
        for (const word of descWords) {
            if (word.length > 4 && lower.includes(word)) {
                score += 1;
            }
        }
        if (score >= 8) {
            scored.push({ skill, score });
        }
    }
    // Sort by score descending and return top N
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSkills)
        .map(s => s.skill);
}
// Legacy single-skill match (for backward compatibility)
export function matchSkill(message, skills, ignoreInclusion = false) {
    const matches = matchSkills(message, skills, ignoreInclusion, 1);
    return matches.length > 0 ? matches[0] : null;
}
// Find matching workflow within a skill
export function matchWorkflow(message, skill) {
    const lower = message.toLowerCase();
    for (const workflow of skill.workflows) {
        const triggerWords = workflow.trigger.toLowerCase().split(/[,\s]+/);
        for (const word of triggerWords) {
            if (word.length > 2 && lower.includes(word)) {
                return workflow;
            }
        }
    }
    return null;
}
// Get skill context for system prompt
export function getSkillContext(skill, workflow) {
    let context = `\n\n=== ACTIVE SKILL: ${skill.name} ===\n`;
    context += skill.context;
    if (workflow?.content) {
        context += `\n\n=== ACTIVE WORKFLOW: ${workflow.name} ===\n`;
        context += workflow.content;
    }
    return context;
}
// Get combined context for multiple skills
export function getMultiSkillContext(skills, message) {
    if (skills.length === 0)
        return "";
    let context = `\n\n=== ACTIVE SKILLS (${skills.length}) ===\n`;
    for (const skill of skills) {
        context += `\n--- ${skill.name.toUpperCase()} ---\n`;
        context += skill.context;
        // Check for matching workflow
        const workflow = matchWorkflow(message, skill);
        if (workflow?.content) {
            context += `\n\n--- WORKFLOW: ${workflow.name} ---\n`;
            context += workflow.content;
        }
    }
    return context;
}
// List all available skills
export function listSkills(skills) {
    if (skills.length === 0) {
        return "Hiç skill bulunamadı. Skills klasörüne SKILL.md dosyaları ekleyin.";
    }
    let output = "📚 Mevcut Skill'ler:\n\n";
    for (const skill of skills) {
        const badge = skill.inclusion === "always" ? " 🔒" : "";
        output += `📁 ${skill.name}${badge}\n`;
        output += `   ${skill.description || "Açıklama yok"}\n`;
        if (skill.workflows.length > 0) {
            output += `   Workflow'lar:\n`;
            for (const wf of skill.workflows) {
                output += `   • ${wf.name}: "${wf.trigger}"\n`;
            }
        }
        output += "\n";
    }
    return output;
}
// Get skills that should always be included
export function getAlwaysSkills(skills) {
    return skills.filter(s => s.inclusion === "always");
}
// Get context for always-included skills
export function getAlwaysSkillsContext(skills) {
    const alwaysSkills = getAlwaysSkills(skills);
    if (alwaysSkills.length === 0)
        return "";
    let context = "\n\n=== GLOBAL SKILLS ===\n";
    for (const skill of alwaysSkills) {
        context += `\n--- ${skill.name.toUpperCase()} ---\n`;
        context += skill.context;
    }
    return context;
}
