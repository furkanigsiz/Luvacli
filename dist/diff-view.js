import * as fs from "fs";
// ANSI color codes
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
};
// Generate unified diff between two strings
export function generateDiff(oldContent, newContent, filename) {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diff = [];
    // Header
    diff.push({ type: "header", content: `--- a/${filename}` });
    diff.push({ type: "header", content: `+++ b/${filename}` });
    // Simple LCS-based diff
    const lcs = computeLCS(oldLines, newLines);
    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
            if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
                // Context line
                diff.push({ type: "context", content: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
                oldIdx++;
                newIdx++;
                lcsIdx++;
            }
            else {
                // Added line
                diff.push({ type: "add", content: newLines[newIdx], newLine: newIdx + 1 });
                newIdx++;
            }
        }
        else if (oldIdx < oldLines.length) {
            // Removed line
            diff.push({ type: "remove", content: oldLines[oldIdx], oldLine: oldIdx + 1 });
            oldIdx++;
        }
        else if (newIdx < newLines.length) {
            // Added line
            diff.push({ type: "add", content: newLines[newIdx], newLine: newIdx + 1 });
            newIdx++;
        }
    }
    return diff;
}
// Compute Longest Common Subsequence
function computeLCS(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            }
            else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    // Backtrack to find LCS
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (a[i - 1] === b[j - 1]) {
            lcs.unshift(a[i - 1]);
            i--;
            j--;
        }
        else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        }
        else {
            j--;
        }
    }
    return lcs;
}
// Format diff with colors for terminal
export function formatDiff(diff, contextLines = 3) {
    let output = "";
    let lastPrintedIdx = -1;
    // Find chunks with changes
    const chunks = [];
    let chunkStart = -1;
    for (let i = 0; i < diff.length; i++) {
        if (diff[i].type === "add" || diff[i].type === "remove") {
            if (chunkStart === -1)
                chunkStart = Math.max(0, i - contextLines);
            chunks.push({ start: chunkStart, end: Math.min(diff.length - 1, i + contextLines) });
            chunkStart = -1;
        }
    }
    // Merge overlapping chunks
    const mergedChunks = [];
    for (const chunk of chunks) {
        if (mergedChunks.length === 0 || chunk.start > mergedChunks[mergedChunks.length - 1].end + 1) {
            mergedChunks.push(chunk);
        }
        else {
            mergedChunks[mergedChunks.length - 1].end = Math.max(mergedChunks[mergedChunks.length - 1].end, chunk.end);
        }
    }
    // Print chunks
    for (const chunk of mergedChunks) {
        if (lastPrintedIdx !== -1 && chunk.start > lastPrintedIdx + 1) {
            output += `${colors.cyan}@@ ... @@${colors.reset}\n`;
        }
        for (let i = chunk.start; i <= chunk.end; i++) {
            const line = diff[i];
            if (!line)
                continue;
            switch (line.type) {
                case "header":
                    output += `${colors.yellow}${line.content}${colors.reset}\n`;
                    break;
                case "add":
                    output += `${colors.green}+${line.content}${colors.reset}\n`;
                    break;
                case "remove":
                    output += `${colors.red}-${line.content}${colors.reset}\n`;
                    break;
                case "context":
                    output += `${colors.gray} ${line.content}${colors.reset}\n`;
                    break;
            }
            lastPrintedIdx = i;
        }
    }
    return output;
}
// Show diff for a file change (oldContent parameter for when file is already written)
export function showFileDiff(filePath, newContent, oldContent) {
    // If oldContent not provided, try to read from file
    if (oldContent === undefined) {
        oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    }
    if (oldContent === newContent) {
        return `${colors.gray}No changes${colors.reset}`;
    }
    const diff = generateDiff(oldContent, newContent, filePath);
    return formatDiff(diff);
}
// Summary stats
export function getDiffStats(oldContent, newContent) {
    const diff = generateDiff(oldContent, newContent, "file");
    let added = 0, removed = 0;
    for (const line of diff) {
        if (line.type === "add")
            added++;
        if (line.type === "remove")
            removed++;
    }
    return { added, removed, changed: Math.min(added, removed) };
}
// Format stats
export function formatDiffStats(stats) {
    return `${colors.green}+${stats.added}${colors.reset} ${colors.red}-${stats.removed}${colors.reset}`;
}
