import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "coverage"];
// Get completions for @ mentions
export function getCompletions(partial, cwd) {
    // Check what type of mention
    if (partial.startsWith("@file:")) {
        return getFileCompletions(partial.slice(6), cwd, "file");
    }
    if (partial.startsWith("@folder:")) {
        return getFileCompletions(partial.slice(8), cwd, "folder");
    }
    if (partial.startsWith("@image:")) {
        return getImageCompletions(partial.slice(7), cwd);
    }
    if (partial === "@" || partial.startsWith("@")) {
        // Show mention types
        const types = ["@file:", "@folder:", "@image:", "@web:", "@symbol:", "@git", "@git:diff"];
        const query = partial.slice(1).toLowerCase();
        return types.filter(t => t.toLowerCase().includes(query));
    }
    return [];
}
// Get file/folder completions
function getFileCompletions(partial, cwd, type) {
    const completions = [];
    const dir = partial.includes("/") ? path.dirname(partial) : ".";
    const prefix = partial.includes("/") ? path.basename(partial) : partial;
    const searchDir = path.resolve(cwd, dir);
    if (!fs.existsSync(searchDir))
        return [];
    try {
        const items = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const item of items) {
            if (item.name.startsWith(".") || IGNORE_DIRS.includes(item.name))
                continue;
            if (!item.name.toLowerCase().startsWith(prefix.toLowerCase()))
                continue;
            const relativePath = dir === "." ? item.name : `${dir}/${item.name}`;
            if (type === "folder" && item.isDirectory()) {
                completions.push(`@folder:${relativePath}`);
            }
            else if (type === "file") {
                if (item.isDirectory()) {
                    completions.push(`@file:${relativePath}/`);
                }
                else {
                    completions.push(`@file:${relativePath}`);
                }
            }
        }
    }
    catch { }
    return completions.slice(0, 10);
}
// Get image file completions
function getImageCompletions(partial, cwd) {
    const completions = [];
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    const dir = partial.includes("/") ? path.dirname(partial) : ".";
    const prefix = partial.includes("/") ? path.basename(partial) : partial;
    const searchDir = path.resolve(cwd, dir);
    if (!fs.existsSync(searchDir))
        return [];
    try {
        const items = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const item of items) {
            if (item.name.startsWith("."))
                continue;
            if (!item.name.toLowerCase().startsWith(prefix.toLowerCase()))
                continue;
            const relativePath = dir === "." ? item.name : `${dir}/${item.name}`;
            if (item.isDirectory()) {
                completions.push(`@image:${relativePath}/`);
            }
            else if (imageExts.some(ext => item.name.toLowerCase().endsWith(ext))) {
                completions.push(`@image:${relativePath}`);
            }
        }
    }
    catch { }
    return completions.slice(0, 10);
}
// Custom readline with tab completion
export function createReadlineWithCompletion(cwd) {
    const completer = (line) => {
        // Find the last @ mention being typed
        const words = line.split(" ");
        const lastWord = words[words.length - 1];
        if (lastWord.startsWith("@")) {
            const completions = getCompletions(lastWord, cwd);
            return [completions, lastWord];
        }
        return [[], line];
    };
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer,
        terminal: true
    });
}
// Show completion menu
export function showCompletionMenu(completions) {
    if (completions.length === 0)
        return;
    console.log("\n" + "─".repeat(40));
    completions.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c}`);
    });
    console.log("─".repeat(40));
}
