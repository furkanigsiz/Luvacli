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

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLine?: number;
  newLine?: number;
}

// Generate unified diff between two strings
export function generateDiff(oldContent: string, newContent: string, filename: string): DiffLine[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff: DiffLine[] = [];

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
      } else {
        // Added line
        diff.push({ type: "add", content: newLines[newIdx], newLine: newIdx + 1 });
        newIdx++;
      }
    } else if (oldIdx < oldLines.length) {
      // Removed line
      diff.push({ type: "remove", content: oldLines[oldIdx], oldLine: oldIdx + 1 });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      // Added line
      diff.push({ type: "add", content: newLines[newIdx], newLine: newIdx + 1 });
      newIdx++;
    }
  }

  return diff;
}

// Compute Longest Common Subsequence
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

// Format diff with colors for terminal
export function formatDiff(diff: DiffLine[], contextLines = 3): string {
  let output = "";
  let lastPrintedIdx = -1;
  
  // Find chunks with changes
  const chunks: { start: number; end: number }[] = [];
  let chunkStart = -1;
  
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type === "add" || diff[i].type === "remove") {
      if (chunkStart === -1) chunkStart = Math.max(0, i - contextLines);
      chunks.push({ start: chunkStart, end: Math.min(diff.length - 1, i + contextLines) });
      chunkStart = -1;
    }
  }

  // Merge overlapping chunks
  const mergedChunks: { start: number; end: number }[] = [];
  for (const chunk of chunks) {
    if (mergedChunks.length === 0 || chunk.start > mergedChunks[mergedChunks.length - 1].end + 1) {
      mergedChunks.push(chunk);
    } else {
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
      if (!line) continue;

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
export function showFileDiff(filePath: string, newContent: string, oldContent?: string): string {
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
export function getDiffStats(oldContent: string, newContent: string): { added: number; removed: number; changed: number } {
  const diff = generateDiff(oldContent, newContent, "file");
  let added = 0, removed = 0;

  for (const line of diff) {
    if (line.type === "add") added++;
    if (line.type === "remove") removed++;
  }

  return { added, removed, changed: Math.min(added, removed) };
}

// Format stats
export function formatDiffStats(stats: { added: number; removed: number }): string {
  return `${colors.green}+${stats.added}${colors.reset} ${colors.red}-${stats.removed}${colors.reset}`;
}
