#!/usr/bin/env node
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { toolDeclarations, executeTool, executeToolsParallel, getModifiedFiles, hasModifiedFiles } from "./tools.js";
import { discoverSkills, matchSkills, getMultiSkillContext, getAlwaysSkillsContext, listSkills } from "./skills.js";
import { indexCodebase } from "./codebase.js";
import { selectRelevantFiles, buildContextString } from "./context.js";
import { parseMentions, buildMentionContext, formatMentions } from "./mentions.js";
import { parseImageReferences, buildImageParts, formatImageInfo } from "./image.js";
import { createReadlineWithCompletion } from "./autocomplete.js";
import { createSpec, loadSpec, listSpecs, getActiveSpec, updateTaskStatus, formatSpec, formatSpecsList, saveSpec, saveSpecMarkdown, getRequirementsPrompt, getDesignPrompt, getTasksPrompt, getImplementPrompt, getSpecReferences } from "./spec.js";
import { getActiveSteeringFiles, buildSteeringContext, listSteeringFiles } from "./steering.js";
import { formatProcessList, cleanupAllProcesses } from "./process.js";
import { resetUsage, addUsage, addToolCalls, formatResponseUsage, formatSessionSummary, getQuickStats } from "./usage.js";
import { optimizeHistory, getContextStats } from "./context-optimizer.js";
import { initSmartContext, getSmartContext, isSmartIndexReady, formatSmartContextInfo } from "./smart-context.js";
import { startFileWatcher, stopFileWatcher, getWatcherStatus } from "./file-watcher.js";
import { getDiagnostics, formatDiagnostics } from "./diagnostics.js";
import { addMCPServer, removeMCPServer, connectAllServers, disconnectAllServers, listMCPServers, getMCPTools, listPopularServers, addPopularServer, popularServers } from "./mcp.js";
import { listTemplates, createProject } from "./templates.js";
import { detectTestFramework, generateTestForFile, formatTestGenResult, getRunCommand, getInstallCommand } from "./test-gen.js";
import { runAgentMode, runAgentFromSpec } from "./agent.js";
import { getBasePrompt } from "./prompts.js";
// Helper: Truncate tool output for terminal display
function truncateToolOutput(toolName, result, maxLines = 10) {
    // read_file için sadece özet göster
    if (toolName === "read_file" && result.includes("```")) {
        const firstLine = result.split("\n")[0];
        return firstLine; // Sadece "📄 dosya.ts (50 satır, 2.1KB)"
    }
    // list_directory için kısalt
    if (toolName === "list_directory") {
        const lines = result.split("\n");
        if (lines.length > maxLines) {
            return lines.slice(0, maxLines).join("\n") + `\n... ve ${lines.length - maxLines} satır daha`;
        }
    }
    // search_files için kısalt
    if (toolName === "search_files" && result.length > 500) {
        return result.slice(0, 500) + "\n... (kısaltıldı)";
    }
    // Genel kısaltma
    const lines = result.split("\n");
    if (lines.length > 30) {
        return lines.slice(0, 30).join("\n") + `\n... ve ${lines.length - 30} satır daha`;
    }
    return result;
}
// Helper: Clean markdown and colorize AI output
function formatAIOutput(text) {
    let output = text;
    // Remove markdown formatting
    output = output
        .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
        .replace(/\*([^*]+)\*/g, "$1") // *italic* → italic
        .replace(/__([^_]+)__/g, "$1") // __bold__ → bold
        .replace(/_([^_]+)_/g, "$1") // _italic_ → italic
        .replace(/^#{1,6}\s+/gm, "") // ## headers → remove
        .replace(/^>\s+/gm, "  ") // > quotes → indent
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [text](url) → text
    // Add subtle color (light gray/white)
    return `\x1b[97m${output}\x1b[0m`;
}
// Load config from global location first, then local
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const LUVA_CONFIG_DIR = path.join(HOME, ".config", "luva");
const LUVA_SKILLS_DIR = path.join(LUVA_CONFIG_DIR, "skills");
const LUVA_HISTORY_DIR = path.join(LUVA_CONFIG_DIR, "history");
const LUVA_CONTEXT_DIR = path.join(LUVA_CONFIG_DIR, "context");
const GLOBAL_ENV_PATH = path.join(LUVA_CONFIG_DIR, ".env");
const LOCAL_ENV_PATH = path.join(process.cwd(), ".env");
// Load .env manually (global first, local overrides)
function loadEnvFile(filePath) {
    const env = {};
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
                const [key, ...valueParts] = trimmed.split("=");
                if (key) {
                    let value = valueParts.join("=").trim();
                    // Remove quotes
                    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    env[key.trim()] = value;
                }
            }
        }
    }
    return env;
}
// Load global config first
const globalEnv = loadEnvFile(GLOBAL_ENV_PATH);
const localEnv = loadEnvFile(LOCAL_ENV_PATH);
// Apply global first (always)
for (const [key, value] of Object.entries(globalEnv)) {
    process.env[key] = value;
}
// Local can override (except API key - global takes priority)
for (const [key, value] of Object.entries(localEnv)) {
    if (key !== "GEMINI_API_KEY") {
        process.env[key] = value;
    }
}
// Config
let GEMINI_API_KEY = globalEnv.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const MODEL = process.env.LUVA_MODEL || "models/gemini-3-flash-preview";
// Interactive API key setup
async function setupApiKey() {
    const readline = await import("readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🔑 Luva - İlk Kurulum                                   ║
╚═══════════════════════════════════════════════════════════╝

Gemini API key'inizi girin.
API key almak için: https://aistudio.google.com/apikey
`);
        rl.question("🔑 API Key: ", (apiKey) => {
            rl.close();
            const trimmedKey = apiKey.trim();
            if (!trimmedKey) {
                console.log("❌ API key boş olamaz.");
                process.exit(1);
            }
            // Save to global config
            ensureLuvaDirectories();
            const envContent = `GEMINI_API_KEY=${trimmedKey}\n`;
            fs.writeFileSync(GLOBAL_ENV_PATH, envContent);
            console.log(`\n✅ API key kaydedildi: ${GLOBAL_ENV_PATH}`);
            console.log("🚀 Luva başlatılıyor...\n");
            resolve(trimmedKey);
        });
    });
}
// Check and setup API key if needed
async function ensureApiKey() {
    if (GEMINI_API_KEY) {
        return GEMINI_API_KEY;
    }
    return await setupApiKey();
}
// Ensure Luva directories exist
function ensureLuvaDirectories() {
    const dirs = [LUVA_CONFIG_DIR, LUVA_SKILLS_DIR, LUVA_HISTORY_DIR, LUVA_CONTEXT_DIR];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}
// Load global context files from ~/.config/luva/context/
function loadGlobalContext() {
    let context = "";
    if (!fs.existsSync(LUVA_CONTEXT_DIR))
        return context;
    try {
        const files = fs.readdirSync(LUVA_CONTEXT_DIR);
        for (const file of files) {
            if (file.endsWith(".md")) {
                const filePath = path.join(LUVA_CONTEXT_DIR, file);
                context += `\n\n--- ${file} ---\n${fs.readFileSync(filePath, "utf-8")}`;
            }
        }
    }
    catch { }
    return context;
}
// History management - now uses ~/.config/luva/history/
function loadHistory() {
    const historyFile = path.join(LUVA_HISTORY_DIR, "current.json");
    if (fs.existsSync(historyFile)) {
        try {
            return JSON.parse(fs.readFileSync(historyFile, "utf-8"));
        }
        catch {
            return [];
        }
    }
    return [];
}
function saveHistory(history) {
    ensureLuvaDirectories();
    fs.writeFileSync(path.join(LUVA_HISTORY_DIR, "current.json"), JSON.stringify(history, null, 2));
}
function saveSessionSummary(history) {
    if (history.length === 0)
        return;
    ensureLuvaDirectories();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let summary = `# Session ${timestamp}\n\n`;
    for (const msg of history) {
        const role = msg.role === "user" ? "**User**" : "**Luva**";
        const textPart = msg.parts?.find((p) => p.text);
        const text = textPart?.text || "[tool call]";
        summary += `${role}: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}\n\n`;
    }
    fs.writeFileSync(path.join(LUVA_HISTORY_DIR, `session-${timestamp}.md`), summary);
}
// Main function with skill routing
async function main() {
    // Ensure directories exist
    ensureLuvaDirectories();
    // Ensure API key exists (prompt if not)
    const apiKey = await ensureApiKey();
    GEMINI_API_KEY = apiKey;
    // Reset usage tracking for new session
    resetUsage();
    const genAI = new GoogleGenerativeAI(apiKey);
    const globalContext = loadGlobalContext();
    const skills = discoverSkills();
    console.log(`\n📚 ${skills.length} skill yüklendi: ${skills.map(s => s.name).join(", ") || "yok"}`);
    // Auto-index codebase on startup
    let codebaseIndex = null;
    let autoContext = true; // Enable auto context by default
    let activeSpec = getActiveSpec(process.cwd()); // Load active spec
    if (activeSpec) {
        console.log(`📋 Aktif spec: ${activeSpec.title} [${activeSpec.status}]`);
    }
    // Load steering files
    let steeringFiles = getActiveSteeringFiles(process.cwd());
    if (steeringFiles.length > 0) {
        console.log(`📋 ${steeringFiles.length} steering yüklendi: ${steeringFiles.map(s => s.name).join(", ")}`);
    }
    console.log("🔍 Codebase indexleniyor...");
    try {
        codebaseIndex = await indexCodebase(process.cwd());
        console.log(codebaseIndex.summary);
    }
    catch (e) {
        console.log("⚠️ Codebase index başarısız, devam ediliyor...");
    }
    // Try to load smart context from cache
    try {
        const { loadEmbeddingIndex } = await import("./embeddings.js");
        const cached = loadEmbeddingIndex(process.cwd());
        if (cached) {
            // Initialize smart index with cached embeddings
            await initSmartContext(genAI, process.cwd());
        }
    }
    catch (e) {
        // Cache not found, user can run 'si' to create
    }
    // Build steering context for system prompt
    const steeringContext = buildSteeringContext(steeringFiles);
    // Get always-included skills context
    const alwaysSkillsContext = getAlwaysSkillsContext(skills);
    // Base prompt'u prompts.ts'den al ve context ekle
    const basePrompt = getBasePrompt(process.cwd()) + `

${globalContext}
${steeringContext}
${alwaysSkillsContext}`;
    const createModel = (extraContext = "") => genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: { role: "user", parts: [{ text: basePrompt + extraContext }] },
        tools: [{ functionDeclarations: toolDeclarations }],
        // Gemini 3 + tools için thinkingConfig kullanılmamalı - thought_signature hatası veriyor
        generationConfig: {
            responseModalities: ["TEXT"]
        }
    });
    let model = createModel();
    let history = loadHistory();
    let rl = createReadlineWithCompletion(process.cwd());
    // ANSI colors
    const c = {
        reset: "\x1b[0m",
        dim: "\x1b[2m",
        cyan: "\x1b[36m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        bold: "\x1b[1m",
    };
    console.log(`
${c.cyan}${c.bold}  ╭─────────────────────────────────────────╮${c.reset}
${c.cyan}${c.bold}  │${c.reset}  ${c.magenta}◆${c.reset} ${c.bold}Luva${c.reset} ${c.dim}v1.0.0${c.reset}                          ${c.cyan}${c.bold}│${c.reset}
${c.cyan}${c.bold}  │${c.reset}  ${c.dim}Agentic AI Assistant${c.reset}                  ${c.cyan}${c.bold}│${c.reset}
${c.cyan}${c.bold}  ╰─────────────────────────────────────────╯${c.reset}

${c.dim}  cwd:${c.reset} ${process.cwd()}
${c.dim}  model:${c.reset} ${MODEL}

${c.dim}  Komutlar:${c.reset}
    ${c.yellow}?${c.reset} help          ${c.yellow}!${c.reset}cmd shell       ${c.yellow}/new${c.reset} template
    ${c.yellow}/spec${c.reset} workflow  ${c.yellow}/test${c.reset} testing   ${c.yellow}mcp${c.reset} servers
    ${c.yellow}@file${c.reset} mention   ${c.yellow}si${c.reset} smart index  ${c.yellow}config${c.reset} settings

${c.dim}  Çıkmak için 'exit' veya Ctrl+C${c.reset}
`);
    const ask = () => {
        rl.question(`\n${c.green}>${c.reset} `, async (input) => {
            const msg = input.trim();
            if (!msg) {
                ask();
                return;
            }
            // Help command
            if (msg === "?" || msg === "help") {
                console.log(`
${c.bold}Komutlar${c.reset}
  ${c.yellow}exit${c.reset}              Çıkış
  ${c.yellow}clear${c.reset}             Sohbeti temizle
  ${c.yellow}config${c.reset}            Config klasörünü aç
  ${c.yellow}!<cmd>${c.reset}            Shell komutu çalıştır (örn: !npm run dev)

${c.bold}Context${c.reset}
  ${c.yellow}@file:path${c.reset}        Dosya ekle
  ${c.yellow}@folder:path${c.reset}      Klasör ekle
  ${c.yellow}@img:path${c.reset}         Görsel ekle (png/jpg/webp)
  ${c.yellow}@web:query${c.reset}        Web araması
  ${c.yellow}@git${c.reset}              Git diff ekle
  ${c.yellow}si${c.reset}                Smart index oluştur
  ${c.yellow}ctx${c.reset}               Context istatistikleri

${c.bold}Agent Mode${c.reset} ${c.magenta}(NEW!)${c.reset}
  ${c.yellow}/agent <goal>${c.reset}     Tam otomatik görev çalıştır
  ${c.yellow}/agent spec${c.reset}       Aktif spec'i otomatik uygula

${c.bold}Geliştirme${c.reset}
  ${c.yellow}/new list${c.reset}         Proje şablonları
  ${c.yellow}/new <t> <name>${c.reset}   Yeni proje oluştur
  ${c.yellow}/test${c.reset}             Test framework bilgisi
  ${c.yellow}/test gen <f>${c.reset}     Test dosyası oluştur

${c.bold}Spec (Kiro-style)${c.reset}
  ${c.yellow}/spec new <t>${c.reset}     Yeni spec başlat
  ${c.yellow}/spec req${c.reset}         Requirements oluştur
  ${c.yellow}/spec design${c.reset}      Design oluştur
  ${c.yellow}/spec tasks${c.reset}       Tasks oluştur
  ${c.yellow}/spec next${c.reset}        Sonraki task'ı uygula
  ${c.yellow}/spec auto${c.reset}        Tüm spec'i otomatik uygula
  ${c.dim}Tip: #[[file:api.yaml]] ile dış dosya referansı${c.reset}

${c.bold}Process${c.reset}
  ${c.yellow}ps${c.reset}                Çalışan process'ler
  ${c.yellow}stop <id>${c.reset}         Process durdur
  ${c.yellow}output <id>${c.reset}       Process çıktısı

${c.bold}MCP${c.reset}
  ${c.yellow}mcp${c.reset}               Server listesi
  ${c.yellow}mcp popular${c.reset}       Popüler server'lar
  ${c.yellow}mcp install <n>${c.reset}   Server kur
`);
                ask();
                return;
            }
            // Commands
            if (msg === "exit") {
                stopFileWatcher();
                cleanupAllProcesses();
                saveSessionSummary(history);
                console.log(formatSessionSummary());
                console.log(`\n${c.dim}👋 Görüşürüz!${c.reset}`);
                rl.close();
                process.exit(0);
            }
            if (msg === "clear") {
                history = [];
                model = createModel();
                saveHistory(history);
                console.log("🗑️ Temizlendi.");
                ask();
                return;
            }
            if (msg === "tools") {
                console.log("\n🛠️ Tool'lar:");
                toolDeclarations.forEach((t) => console.log(`  • ${t.name}`));
                ask();
                return;
            }
            if (msg === "skills") {
                console.log("\n" + listSkills(skills));
                ask();
                return;
            }
            if (msg === "undo") {
                const { undoLastChange } = await import("./history.js");
                console.log(undoLastChange().message);
                ask();
                return;
            }
            if (msg === "history") {
                const { getRecentChanges } = await import("./history.js");
                console.log(getRecentChanges(10));
                ask();
                return;
            }
            if (msg.startsWith("restore ")) {
                const { restoreSnapshot } = await import("./history.js");
                console.log(restoreSnapshot(msg.slice(8).trim()).message);
                ask();
                return;
            }
            if (msg.startsWith("cd ")) {
                try {
                    process.chdir(path.resolve(process.cwd(), msg.slice(3)));
                    codebaseIndex = await indexCodebase(process.cwd());
                    steeringFiles = getActiveSteeringFiles(process.cwd()); // Reload steering
                    rl.close();
                    rl = createReadlineWithCompletion(process.cwd());
                    console.log(`📂 ${process.cwd()}`);
                    console.log(codebaseIndex.summary);
                    if (steeringFiles.length > 0) {
                        console.log(`📋 ${steeringFiles.length} steering: ${steeringFiles.map(s => s.name).join(", ")}`);
                    }
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "context on") {
                autoContext = true;
                console.log("✅ Auto-context açık");
                ask();
                return;
            }
            if (msg === "context off") {
                autoContext = false;
                console.log("❌ Auto-context kapalı");
                ask();
                return;
            }
            if (msg === "context stats" || msg === "ctx") {
                const stats = getContextStats(history, basePrompt);
                console.log(`\n📊 Context Stats:`);
                console.log(`  📝 System prompt: ~${stats.systemTokens.toLocaleString()} token`);
                console.log(`  💬 History: ${stats.messageCount} mesaj, ~${stats.historyTokens.toLocaleString()} token`);
                console.log(`  Σ  Toplam: ~${stats.totalTokens.toLocaleString()} token`);
                ask();
                return;
            }
            if (msg === "reindex") {
                console.log("🔍 Reindexing...");
                codebaseIndex = await indexCodebase(process.cwd());
                console.log(codebaseIndex.summary);
                ask();
                return;
            }
            if (msg === "smart index" || msg === "si") {
                console.log("🧠 Smart context oluşturuluyor (embedding + dependency graph)...");
                try {
                    await initSmartContext(genAI, process.cwd());
                    // Start file watcher for incremental updates
                    startFileWatcher(genAI, process.cwd());
                }
                catch (e) {
                    console.log(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "smart reindex" || msg === "sir") {
                console.log("🧠 Smart context yeniden oluşturuluyor (cache yok sayılıyor)...");
                try {
                    stopFileWatcher();
                    await initSmartContext(genAI, process.cwd(), true);
                    startFileWatcher(genAI, process.cwd());
                }
                catch (e) {
                    console.log(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "watch" || msg === "watcher") {
                console.log("\n" + getWatcherStatus());
                ask();
                return;
            }
            if (msg === "watch start") {
                startFileWatcher(genAI, process.cwd());
                ask();
                return;
            }
            if (msg === "watch stop") {
                stopFileWatcher();
                ask();
                return;
            }
            if (msg === "smart status" || msg === "ss") {
                console.log("\n" + formatSmartContextInfo());
                ask();
                return;
            }
            if (msg === "processes" || msg === "ps") {
                console.log("\n" + formatProcessList());
                ask();
                return;
            }
            if (msg === "steering") {
                console.log("\n" + listSteeringFiles(process.cwd()));
                ask();
                return;
            }
            if (msg === "security") {
                const { getSecurityInfo } = await import("./security.js");
                console.log(getSecurityInfo());
                ask();
                return;
            }
            if (msg === "config" || msg === "settings") {
                console.log(`\n📁 Luva config: ${LUVA_CONFIG_DIR}`);
                try {
                    const { exec } = await import("child_process");
                    const cmd = process.platform === "win32" ? `explorer "${LUVA_CONFIG_DIR}"` :
                        process.platform === "darwin" ? `open "${LUVA_CONFIG_DIR}"` : `xdg-open "${LUVA_CONFIG_DIR}"`;
                    exec(cmd);
                    console.log("✅ Klasör açıldı.");
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "usage" || msg === "stats") {
                console.log("\n" + getQuickStats());
                ask();
                return;
            }
            // Direct shell commands with ! or $ prefix
            if (msg.startsWith("!") || msg.startsWith("$")) {
                const cmd = msg.slice(1).trim();
                if (!cmd) {
                    ask();
                    return;
                }
                // Long-running commands (dev servers, watchers)
                const longRunning = ["npm run dev", "npm start", "yarn dev", "yarn start", "npx vite", "node --watch", "tsx watch", "tsc --watch"];
                const isLongRunning = longRunning.some(lr => cmd.startsWith(lr));
                if (isLongRunning) {
                    console.log(`\n🚀 ${cmd}\n`);
                    try {
                        const { startProcess } = await import("./process.js");
                        const result = startProcess(cmd, process.cwd());
                        console.log(result.message);
                        // Don't call ask() immediately - let the process output flow
                        // User can press Enter to get back to prompt
                        setTimeout(() => {
                            console.log("\n💡 Enter'a bas veya yeni komut yaz. 'ps' ile process'leri gör, 'stop <id>' ile durdur.");
                            ask();
                        }, 3000);
                        return;
                    }
                    catch (e) {
                        console.log(`❌ ${e.message}`);
                    }
                }
                else {
                    // Normal command - run and wait
                    console.log(`\n⚡ ${cmd}\n`);
                    try {
                        const { execSync } = await import("child_process");
                        execSync(cmd, { cwd: process.cwd(), stdio: "inherit" });
                    }
                    catch { }
                }
                ask();
                return;
            }
            // MCP Commands
            if (msg === "mcp" || msg === "mcp list") {
                console.log("\n" + listMCPServers());
                ask();
                return;
            }
            if (msg === "mcp popular") {
                console.log("\n" + listPopularServers());
                ask();
                return;
            }
            if (msg.startsWith("mcp install ")) {
                const name = msg.slice(12).trim();
                if (popularServers[name]) {
                    try {
                        addPopularServer(name);
                        console.log(`✅ ${name} eklendi. Bağlanmak için: mcp connect`);
                    }
                    catch (e) {
                        console.log(`❌ ${e.message}`);
                    }
                }
                else {
                    console.log(`❌ Bilinmeyen server: ${name}\nMevcut: ${Object.keys(popularServers).join(", ")}`);
                }
                ask();
                return;
            }
            if (msg.startsWith("mcp add ")) {
                const parts = msg.slice(8).trim().split(/\s+/);
                const name = parts[0];
                const command = parts[1];
                const args = parts.slice(2);
                if (!name || !command) {
                    console.log("Kullanım: mcp add <name> <command> [args...]");
                    ask();
                    return;
                }
                try {
                    addMCPServer(name, command, args);
                    console.log(`✅ ${name} eklendi.`);
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            if (msg.startsWith("mcp remove ")) {
                const name = msg.slice(11).trim();
                if (removeMCPServer(name))
                    console.log(`✅ ${name} silindi.`);
                else
                    console.log(`❌ Server bulunamadı: ${name}`);
                ask();
                return;
            }
            if (msg === "mcp connect") {
                console.log("📡 MCP sunucularına bağlanılıyor...");
                try {
                    const tools = await connectAllServers();
                    console.log(`✅ ${tools.length} tool yüklendi.`);
                    for (const t of tools)
                        console.log(`   • ${t.serverName}/${t.name}`);
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "mcp disconnect") {
                disconnectAllServers();
                console.log("✅ Tüm MCP bağlantıları kapatıldı.");
                ask();
                return;
            }
            if (msg === "mcp tools") {
                const tools = getMCPTools();
                if (tools.length === 0) {
                    console.log("❌ Bağlı MCP yok. Önce: mcp connect");
                }
                else {
                    console.log("\n🔧 MCP Tools:");
                    for (const t of tools)
                        console.log(`   • ${t.serverName}/${t.name}: ${t.description}`);
                }
                ask();
                return;
            }
            // Template Commands
            if (msg === "/new" || msg === "/new list") {
                console.log("\n" + listTemplates());
                ask();
                return;
            }
            if (msg.startsWith("/new ")) {
                const parts = msg.slice(5).trim().split(/\s+/);
                if (parts[0] === "list") {
                    console.log("\n" + listTemplates());
                    ask();
                    return;
                }
                const templateName = parts[0];
                const projectName = parts[1];
                if (!templateName || !projectName) {
                    console.log("Kullanım: /new <template> <project-name>\nTemplates için: /new list");
                    ask();
                    return;
                }
                try {
                    const result = await createProject(templateName, projectName);
                    console.log(result);
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            // Test Commands
            if (msg === "/test") {
                const config = detectTestFramework(process.cwd());
                console.log(`\n🧪 Test Framework: ${config.framework}`);
                console.log(`Çalıştır: ${getRunCommand(config.framework)}`);
                const install = getInstallCommand(config.framework);
                if (install)
                    console.log(`Kur: ${install}`);
                ask();
                return;
            }
            if (msg.startsWith("/test gen ") || msg.startsWith("/test generate ")) {
                const file = msg.replace(/^\/test\s+(gen|generate)\s+/, "").trim();
                if (!file) {
                    console.log("Kullanım: /test gen <file.ts>");
                    ask();
                    return;
                }
                try {
                    const { testPath, content } = generateTestForFile(file, process.cwd());
                    fs.writeFileSync(path.join(process.cwd(), testPath), content);
                    const config = detectTestFramework(process.cwd());
                    console.log(formatTestGenResult(testPath, config.framework));
                }
                catch (e) {
                    console.log(`❌ ${e.message}`);
                }
                ask();
                return;
            }
            if (msg.startsWith("/test run")) {
                const file = msg.slice(9).trim();
                const config = detectTestFramework(process.cwd());
                const cmd = getRunCommand(config.framework, file || undefined);
                console.log(`🧪 ${cmd}`);
                try {
                    const { execSync } = await import("child_process");
                    execSync(cmd, { cwd: process.cwd(), stdio: "inherit" });
                }
                catch { }
                ask();
                return;
            }
            // Spec commands
            if (msg === "/spec list" || msg === "/specs") {
                console.log(formatSpecsList(listSpecs(process.cwd())));
                ask();
                return;
            }
            if (msg.startsWith("/spec new ")) {
                const title = msg.slice(10).trim();
                if (!title) {
                    console.log("❌ Başlık gerekli: /spec new <başlık>");
                    ask();
                    return;
                }
                const spec = createSpec(process.cwd(), title, "");
                console.log(`✅ Spec oluşturuldu: ${spec.id}`);
                console.log(`📁 .luva/specs/${spec.id}.md`);
                console.log("\n💡 Şimdi spec'i tanımla, örn: 'kullanıcı login olabilmeli, dashboard görebilmeli'");
                activeSpec = spec;
                ask();
                return;
            }
            if (msg === "/spec show") {
                const spec = activeSpec || getActiveSpec(process.cwd());
                if (!spec) {
                    console.log("❌ Aktif spec yok. /spec new ile oluştur.");
                    ask();
                    return;
                }
                console.log(formatSpec(spec));
                ask();
                return;
            }
            if (msg === "/spec requirements" || msg === "/spec req") {
                if (!activeSpec) {
                    console.log("❌ Önce /spec new ile spec oluştur.");
                    ask();
                    return;
                }
                console.log("📋 Requirements oluşturuluyor...");
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), activeSpec.title)) : "";
                const prompt = getRequirementsPrompt(activeSpec, contextInfo);
                try {
                    await generateSpecPhase(model, activeSpec, prompt, "requirements");
                    console.log(formatSpec(activeSpec));
                }
                catch (e) {
                    console.error(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "/spec design") {
                if (!activeSpec || activeSpec.requirements.length === 0) {
                    console.log("❌ Önce requirements oluştur: /spec requirements");
                    ask();
                    return;
                }
                console.log("🎨 Design oluşturuluyor...");
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), activeSpec.title)) : "";
                const prompt = getDesignPrompt(activeSpec, contextInfo);
                try {
                    await generateSpecPhase(model, activeSpec, prompt, "design");
                    console.log(formatSpec(activeSpec));
                }
                catch (e) {
                    console.error(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "/spec tasks") {
                if (!activeSpec || activeSpec.design.length === 0) {
                    console.log("❌ Önce design oluştur: /spec design");
                    ask();
                    return;
                }
                console.log("✅ Tasks oluşturuluyor...");
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), activeSpec.title)) : "";
                const prompt = getTasksPrompt(activeSpec, contextInfo);
                try {
                    await generateSpecPhase(model, activeSpec, prompt, "tasks");
                    console.log(formatSpec(activeSpec));
                }
                catch (e) {
                    console.error(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg === "/spec next" || msg === "/spec implement") {
                if (!activeSpec || activeSpec.tasks.length === 0) {
                    console.log("❌ Önce tasks oluştur: /spec tasks");
                    ask();
                    return;
                }
                const nextTask = activeSpec.tasks.find(t => t.status === "pending");
                if (!nextTask) {
                    console.log("✅ Tüm tasklar tamamlandı!");
                    ask();
                    return;
                }
                console.log(`\n🔨 Implementing: ${nextTask.title}`);
                updateTaskStatus(process.cwd(), activeSpec.id, nextTask.id, "in-progress");
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), nextTask.file || activeSpec.title)) : "";
                const prompt = getImplementPrompt(activeSpec, nextTask, contextInfo);
                try {
                    await chat(model, history, prompt, `/spec implement ${nextTask.id}`);
                    updateTaskStatus(process.cwd(), activeSpec.id, nextTask.id, "done");
                    activeSpec = loadSpec(process.cwd(), activeSpec.id);
                    console.log(`\n✅ Task tamamlandı: ${nextTask.title}`);
                    const remaining = activeSpec.tasks.filter(t => t.status === "pending").length;
                    if (remaining > 0)
                        console.log(`📋 Kalan: ${remaining} task. /spec next ile devam et.`);
                    else
                        console.log("🎉 Tüm tasklar tamamlandı!");
                }
                catch (e) {
                    console.error(`❌ Hata: ${e.message}`);
                }
                ask();
                return;
            }
            if (msg.startsWith("/spec done ")) {
                const taskId = msg.slice(11).trim();
                if (!activeSpec) {
                    console.log("❌ Aktif spec yok.");
                    ask();
                    return;
                }
                updateTaskStatus(process.cwd(), activeSpec.id, taskId, "done");
                activeSpec = loadSpec(process.cwd(), activeSpec.id);
                console.log(`✅ ${taskId} tamamlandı.`);
                ask();
                return;
            }
            if (msg.startsWith("/spec skip ")) {
                const taskId = msg.slice(11).trim();
                if (!activeSpec) {
                    console.log("❌ Aktif spec yok.");
                    ask();
                    return;
                }
                updateTaskStatus(process.cwd(), activeSpec.id, taskId, "skipped");
                activeSpec = loadSpec(process.cwd(), activeSpec.id);
                console.log(`⏭️ ${taskId} atlandı.`);
                ask();
                return;
            }
            if (msg.startsWith("/spec load ")) {
                const specId = msg.slice(11).trim();
                const spec = loadSpec(process.cwd(), specId);
                if (!spec) {
                    console.log(`❌ Spec bulunamadı: ${specId}`);
                    ask();
                    return;
                }
                activeSpec = spec;
                console.log(`✅ Spec yüklendi: ${spec.title}`);
                console.log(formatSpec(spec));
                ask();
                return;
            }
            // /spec auto - Tüm spec'i otomatik uygula (Agent Mode)
            if (msg === "/spec auto" || msg === "/spec agent") {
                if (!activeSpec) {
                    console.log("❌ Aktif spec yok. /spec new ile oluştur.");
                    ask();
                    return;
                }
                if (activeSpec.tasks.length === 0) {
                    console.log("❌ Önce tasks oluştur: /spec tasks");
                    ask();
                    return;
                }
                const pendingTasks = activeSpec.tasks.filter(t => t.status === "pending");
                if (pendingTasks.length === 0) {
                    console.log("✅ Tüm tasklar zaten tamamlanmış!");
                    ask();
                    return;
                }
                console.log(`\n🤖 Spec Agent Mode başlatılıyor...`);
                console.log(`📋 ${activeSpec.title} - ${pendingTasks.length} pending task\n`);
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), activeSpec.title)) : "";
                // Get spec references for additional context
                const refs = getSpecReferences(activeSpec, process.cwd());
                let refsContext = "";
                if (refs.length > 0) {
                    refsContext = "\n\n## Referenced Files:\n" + refs
                        .filter(r => r.content)
                        .map(r => `### ${r.path}\n\`\`\`\n${r.content.slice(0, 3000)}\n\`\`\``)
                        .join("\n");
                }
                try {
                    const plan = await runAgentFromSpec(model, activeSpec, contextInfo + refsContext);
                    // Update spec task statuses based on agent results
                    for (const step of plan.steps) {
                        const taskIndex = step.id - 1;
                        if (taskIndex < activeSpec.tasks.length) {
                            const status = step.status === "done" ? "done" : step.status === "failed" ? "pending" : "pending";
                            updateTaskStatus(process.cwd(), activeSpec.id, activeSpec.tasks[taskIndex].id, status);
                        }
                    }
                    activeSpec = loadSpec(process.cwd(), activeSpec.id);
                    if (plan.status === "done") {
                        console.log(`\n🎉 Spec tamamlandı: ${activeSpec.title}`);
                    }
                    else {
                        console.log(`\n⚠️ Bazı tasklar tamamlanamadı. /spec show ile kontrol et.`);
                    }
                }
                catch (e) {
                    console.error(`❌ Agent hatası: ${e.message}`);
                }
                ask();
                return;
            }
            // /agent <goal> - Serbest Agent Mode
            if (msg.startsWith("/agent ")) {
                const goal = msg.slice(7).trim();
                // /agent spec - aktif spec'i çalıştır
                if (goal === "spec") {
                    if (!activeSpec) {
                        console.log("❌ Aktif spec yok.");
                        ask();
                        return;
                    }
                    // Redirect to /spec auto
                    console.log("↪️ /spec auto'ya yönlendiriliyor...");
                    // Trigger spec auto logic (simplified - just show message)
                    console.log(`💡 Aktif spec için: /spec auto kullan`);
                    ask();
                    return;
                }
                if (!goal) {
                    console.log(`
${c.bold}Agent Mode Kullanımı${c.reset}

  ${c.yellow}/agent <goal>${c.reset}     Hedefi otomatik gerçekleştir
  ${c.yellow}/agent spec${c.reset}       Aktif spec'i otomatik uygula

${c.bold}Örnekler${c.reset}
  /agent kullanıcı login sistemi ekle
  /agent REST API endpoint'leri oluştur
  /agent hataları düzelt ve test ekle
  /agent proje yapısını refactor et
`);
                    ask();
                    return;
                }
                // Skill routing for agent mode - supports multiple skills
                // ignoreInclusion=true: agent mode should use even manual skills
                const agentSkills = matchSkills(goal, skills, true);
                let skillContext = "";
                if (agentSkills.length > 0) {
                    const skillNames = agentSkills.map(s => s.name).join(", ");
                    console.log(`\n🎯 Skill${agentSkills.length > 1 ? "s" : ""} aktif: ${skillNames}`);
                    skillContext = getMultiSkillContext(agentSkills, goal);
                }
                console.log(`\n🤖 Agent Mode başlatılıyor...`);
                const contextInfo = codebaseIndex ? buildContextString(selectRelevantFiles(process.cwd(), goal)) : "";
                // Combine codebase context with skill context
                const fullContext = skillContext ? `${skillContext}\n\n${contextInfo}` : contextInfo;
                try {
                    await runAgentMode(model, goal, fullContext);
                }
                catch (e) {
                    console.error(`❌ Agent hatası: ${e.message}`);
                }
                ask();
                return;
            }
            // Skill routing - supports multiple skills
            const matchedSkills = matchSkills(msg, skills);
            if (matchedSkills.length > 0) {
                const skillNames = matchedSkills.map(s => s.name).join(", ");
                console.log(`\n🎯 Skill${matchedSkills.length > 1 ? "s" : ""}: ${skillNames}`);
                model = createModel(getMultiSkillContext(matchedSkills, msg));
            }
            // Parse @ mentions
            const { cleanMessage, mentions } = parseMentions(msg, process.cwd());
            const mentionContext = await buildMentionContext(mentions, process.cwd());
            if (mentions.length > 0) {
                console.log(`\n📎 ${formatMentions(mentions)}`);
            }
            // Parse image references
            const { cleanMessage: finalMessage, images } = parseImageReferences(cleanMessage, process.cwd());
            if (images.length > 0) {
                console.log(`${formatImageInfo(images)}`);
            }
            // Smart context gathering (embedding-based if available, fallback to keyword)
            // Skip for simple greetings/chat messages
            let contextInfo = "";
            const isSimpleChat = /^(selam|merhaba|hey|hi|hello|nasılsın|naber|sa|as|teşekkür|sağol|tamam|ok|evet|hayır|peki)[\s?!.]*$/i.test(finalMessage);
            if (autoContext && mentions.length === 0 && !isSimpleChat && finalMessage.length > 10) {
                // Extract mentioned files from mentions
                const mentionedFiles = mentions
                    .filter(m => m.type === "file")
                    .map(m => m.value);
                if (isSmartIndexReady()) {
                    // Use smart context with embeddings
                    try {
                        const smartCtx = await getSmartContext(genAI, finalMessage, {
                            mentionedFiles,
                            maxTokens: 30000
                        });
                        if (smartCtx.sources.length > 0) {
                            console.log(`\x1b[2m🧠 Smart context: ${smartCtx.stats}\x1b[0m`);
                            contextInfo = `\n\n## Relevant Context\n${smartCtx.context}`;
                        }
                    }
                    catch (e) {
                        // Fallback to basic context
                        if (codebaseIndex) {
                            const relevantFiles = selectRelevantFiles(process.cwd(), finalMessage);
                            if (relevantFiles.length > 0) {
                                console.log(`\x1b[2m📋 ${relevantFiles.length} ilgili dosya bulundu\x1b[0m`);
                                contextInfo = buildContextString(relevantFiles);
                            }
                        }
                    }
                }
                else if (codebaseIndex) {
                    // Fallback: keyword-based context
                    const relevantFiles = selectRelevantFiles(process.cwd(), finalMessage);
                    if (relevantFiles.length > 0) {
                        console.log(`\x1b[2m📋 ${relevantFiles.length} ilgili dosya bulundu\x1b[0m`);
                        contextInfo = buildContextString(relevantFiles);
                    }
                }
            }
            // Get active steering names for display
            const activeSteeringNames = steeringFiles.length > 0 ? steeringFiles.map(s => s.name) : undefined;
            // Process message with context
            try {
                const enrichedMsg = `${finalMessage}${mentionContext}${contextInfo}`;
                await chat(model, history, enrichedMsg, msg, images, activeSteeringNames);
                saveHistory(history);
            }
            catch (e) {
                console.error(`\n❌ Hata: ${e.message}`);
            }
            ask();
        });
    };
    ask();
}
// Helper: Add dummy thought signature to skip validation for Gemini 3
function addDummySignatures(parts) {
    return parts.map((p) => {
        if (p.functionCall && !p.thoughtSignature) {
            return { ...p, thoughtSignature: "skip_thought_signature_validator" };
        }
        return p;
    });
}
// Helper: Prepare history with dummy signatures for function calls
function prepareHistoryForGemini3(history) {
    return history.map(msg => {
        if (msg.role === "model" && msg.parts) {
            const hasFunctionCall = msg.parts.some((p) => p.functionCall);
            if (hasFunctionCall) {
                return { ...msg, parts: addDummySignatures(msg.parts) };
            }
        }
        return msg;
    });
}
// Chat with streaming and function calling
async function chat(model, history, userMsg, originalMsg, images, usedSteering) {
    // Store original message in history (without context bloat)
    history.push({ role: "user", parts: [{ text: originalMsg || userMsg }] });
    process.stdout.write("\n\x1b[36m◆\x1b[0m ");
    // Show steering info if used
    if (usedSteering && usedSteering.length > 0) {
        console.log(`\n\x1b[2m📋 Steering: ${usedSteering.join(", ")}\x1b[0m`);
        process.stdout.write("\x1b[36m◆\x1b[0m ");
    }
    // Optimize history to reduce token usage (keep last 50K tokens)
    const optimizedHistory = optimizeHistory(history.slice(0, -1), 50000);
    // Prepare history with dummy signatures for Gemini 3 compatibility
    const preparedHistory = prepareHistoryForGemini3(optimizedHistory);
    const chatSession = model.startChat({ history: preparedHistory });
    // Build message parts (text + images)
    let messageParts;
    if (images && images.length > 0) {
        const imageParts = buildImageParts(images);
        messageParts = [{ text: userMsg }, ...imageParts];
    }
    else {
        messageParts = userMsg;
    }
    // Use non-streaming for Gemini 3 to avoid thought_signature issues
    const response = await chatSession.sendMessage(messageParts);
    const text = response.response.text();
    process.stdout.write(formatAIOutput(text));
    // Track usage
    const usage = addUsage(response.response);
    const parts = response.response.candidates?.[0]?.content?.parts || [];
    const fcs = response.response.functionCalls();
    if (fcs?.length) {
        console.log("");
        addToolCalls(fcs.length);
        // Store parts with signatures preserved from API response
        history.push({ role: "model", parts });
        // Build function response parts - execute in parallel for speed
        const responseParts = [];
        if (fcs.length > 1) {
            // Parallel execution for multiple tools
            console.log(`\n\x1b[2m⏺ ${fcs.length} tool paralel çalışıyor...\x1b[0m`);
            const tools = fcs.map((fc) => ({ name: fc.name, args: fc.args }));
            const results = await executeToolsParallel(tools);
            for (let i = 0; i < fcs.length; i++) {
                console.log(`\x1b[2m  • ${fcs[i].name}\x1b[0m`);
                console.log(truncateToolOutput(fcs[i].name, results[i]));
                responseParts.push({
                    functionResponse: {
                        name: fcs[i].name,
                        response: { result: results[i] }
                    }
                });
            }
        }
        else {
            // Single tool - sequential
            for (const fc of fcs) {
                console.log(`\n\x1b[2m⏺ ${fc.name}\x1b[0m`);
                const result = await executeTool(fc.name, fc.args);
                console.log(truncateToolOutput(fc.name, result));
                responseParts.push({
                    functionResponse: {
                        name: fc.name,
                        response: { result }
                    }
                });
            }
        }
        // Add function responses to history
        history.push({ role: "user", parts: responseParts });
        // Continue with function results
        process.stdout.write("\n\x1b[36m◆\x1b[0m ");
        const nextResponse = await chatSession.sendMessage(responseParts);
        const nextText = nextResponse.response.text();
        process.stdout.write(formatAIOutput(nextText));
        // Track usage for follow-up
        const nextUsage = addUsage(nextResponse.response);
        const nextParts = nextResponse.response.candidates?.[0]?.content?.parts || [];
        const nextFcs = nextResponse.response.functionCalls();
        // Handle chained function calls recursively
        if (nextFcs?.length) {
            addToolCalls(nextFcs.length);
            // Remove the user functionResponse we added, model will handle it
            history.pop();
            history.push({ role: "model", parts: nextParts });
            await handleFunctionCalls(chatSession, history, nextFcs);
        }
        else {
            // Remove the user functionResponse we added
            history.pop();
            // Show usage
            console.log(formatResponseUsage({ prompt: usage.prompt + nextUsage.prompt, completion: usage.completion + nextUsage.completion, total: usage.total + nextUsage.total }));
            history.push({ role: "model", parts: nextParts.length ? nextParts : [{ text: nextText }] });
        }
    }
    else {
        // Show usage
        console.log(formatResponseUsage(usage));
        history.push({ role: "model", parts: parts.length ? parts : [{ text }] });
    }
}
// Handle chained function calls
async function handleFunctionCalls(chatSession, history, fcs) {
    const responseParts = [];
    if (fcs.length > 1) {
        // Parallel execution
        console.log(`\n\x1b[2m⏺ ${fcs.length} tool paralel çalışıyor...\x1b[0m`);
        const tools = fcs.map((fc) => ({ name: fc.name, args: fc.args }));
        const results = await executeToolsParallel(tools);
        for (let i = 0; i < fcs.length; i++) {
            console.log(`\x1b[2m  • ${fcs[i].name}\x1b[0m`);
            console.log(truncateToolOutput(fcs[i].name, results[i]));
            responseParts.push({
                functionResponse: {
                    name: fcs[i].name,
                    response: { result: results[i] }
                }
            });
        }
    }
    else {
        for (const fc of fcs) {
            console.log(`\n\x1b[2m⏺ ${fc.name}\x1b[0m`);
            const result = await executeTool(fc.name, fc.args);
            console.log(truncateToolOutput(fc.name, result));
            responseParts.push({
                functionResponse: {
                    name: fc.name,
                    response: { result }
                }
            });
        }
    }
    process.stdout.write("\n\x1b[36m◆\x1b[0m ");
    const response = await chatSession.sendMessage(responseParts);
    const text = response.response.text();
    process.stdout.write(formatAIOutput(text));
    // Track usage
    const usage = addUsage(response.response);
    const parts = response.response.candidates?.[0]?.content?.parts || [];
    const nextFcs = response.response.functionCalls();
    if (nextFcs?.length) {
        addToolCalls(nextFcs.length);
        history.push({ role: "model", parts });
        await handleFunctionCalls(chatSession, history, nextFcs);
    }
    else {
        console.log(formatResponseUsage(usage));
        history.push({ role: "model", parts: parts.length ? parts : [{ text }] });
        // Auto-diagnostics for modified files - if errors found, ask AI to fix
        const diagnosticErrors = await runAutoDiagnostics();
        if (diagnosticErrors) {
            console.log("\n🔧 Hatalar tespit edildi, düzeltiliyor...");
            // Send errors to AI for fixing
            const fixPrompt = `Yukarıdaki kod değişikliklerinde hatalar tespit edildi. Lütfen bu hataları düzelt:

${diagnosticErrors}

Hataları düzeltmek için gerekli dosyaları edit_file veya write_file ile güncelle.`;
            history.push({ role: "user", parts: [{ text: fixPrompt }] });
            process.stdout.write("\n\x1b[36m◆\x1b[0m ");
            const fixResponse = await chatSession.sendMessage(fixPrompt);
            const fixText = fixResponse.response.text();
            process.stdout.write(formatAIOutput(fixText));
            const fixParts = fixResponse.response.candidates?.[0]?.content?.parts || [];
            const fixFcs = fixResponse.response.functionCalls();
            if (fixFcs?.length) {
                addToolCalls(fixFcs.length);
                history.push({ role: "model", parts: fixParts });
                await handleFunctionCalls(chatSession, history, fixFcs);
            }
            else {
                history.push({ role: "model", parts: fixParts.length ? fixParts : [{ text: fixText }] });
            }
        }
    }
}
// Run diagnostics on modified files automatically
// Returns error message if issues found, for AI to fix
async function runAutoDiagnostics() {
    if (!hasModifiedFiles())
        return null;
    const files = getModifiedFiles();
    if (files.length === 0)
        return null;
    console.log(`\n🔍 Auto-diagnostics: ${files.length} dosya kontrol ediliyor...`);
    try {
        const result = await getDiagnostics(files);
        const output = formatDiagnostics(result);
        // Check if there are errors (not just warnings)
        const hasErrors = output.includes("❌");
        if (hasErrors || output.includes("⚠️")) {
            console.log(output);
            // Return errors for AI to fix
            if (hasErrors) {
                return output;
            }
        }
        else {
            console.log(`✅ ${files.length} dosya: Hata yok`);
        }
    }
    catch (e) {
        console.log(`⚠️ Diagnostics hatası: ${e.message}`);
    }
    return null;
}
main().catch(console.error);
// Generate spec phase (requirements, design, tasks)
async function generateSpecPhase(model, spec, prompt, phase) {
    const chatSession = model.startChat({ history: [] });
    const result = await chatSession.sendMessage(prompt);
    const text = result.response.text();
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
        throw new Error("JSON parse edilemedi");
    const data = JSON.parse(jsonMatch[0]);
    if (phase === "requirements" && data.requirements) {
        spec.requirements = data.requirements;
        spec.status = "requirements";
    }
    else if (phase === "design" && data.design) {
        spec.design = data.design;
        spec.status = "design";
    }
    else if (phase === "tasks" && data.tasks) {
        spec.tasks = data.tasks.map((t) => ({ ...t, status: "pending" }));
        spec.status = "tasks";
    }
    saveSpec(process.cwd(), spec);
    saveSpecMarkdown(process.cwd(), spec);
}
