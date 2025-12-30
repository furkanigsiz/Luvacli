/**
 * File Watcher - Incremental indexing with chokidar
 * 
 * Dosya değişikliklerini izler ve sadece değişen dosyaları reindex eder
 */

import * as chokidar from "chokidar";
import * as path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseFileIntoChunks, EmbeddingChunk } from "./chunker.js";
import { getEmbeddings, getEmbeddingIndex, saveEmbeddingIndex } from "./embeddings.js";

let watcher: chokidar.FSWatcher | null = null;
let genAI: GoogleGenerativeAI | null = null;
let rootDir: string = "";
let pendingUpdates: Set<string> = new Set();
let updateTimeout: NodeJS.Timeout | null = null;

// Debounce delay (ms)
const DEBOUNCE_DELAY = 2000;

/**
 * Start file watcher for incremental indexing
 */
export function startFileWatcher(
  ai: GoogleGenerativeAI,
  dir: string
): void {
  if (watcher) {
    console.log("⚠️ File watcher zaten çalışıyor");
    return;
  }
  
  genAI = ai;
  rootDir = dir;
  
  const watchPatterns = [
    "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py"
  ];
  
  const ignorePatterns = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/__pycache__/**",
    "**/.luva/**"
  ];
  
  watcher = chokidar.watch(watchPatterns, {
    cwd: dir,
    ignored: ignorePatterns,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });
  
  watcher.on("change", (filePath) => {
    queueUpdate(filePath, "change");
  });
  
  watcher.on("add", (filePath) => {
    queueUpdate(filePath, "add");
  });
  
  watcher.on("unlink", (filePath) => {
    queueUpdate(filePath, "delete");
  });
  
  console.log("👁️ File watcher başlatıldı (incremental indexing aktif)");
}

/**
 * Stop file watcher
 */
export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log("👁️ File watcher durduruldu");
  }
}

/**
 * Queue file update with debouncing
 */
function queueUpdate(filePath: string, type: "change" | "add" | "delete"): void {
  const fullPath = path.join(rootDir, filePath);
  pendingUpdates.add(`${type}:${fullPath}`);
  
  // Debounce: wait for more changes before processing
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }
  
  updateTimeout = setTimeout(() => {
    processUpdates();
  }, DEBOUNCE_DELAY);
}

/**
 * Process pending file updates
 */
async function processUpdates(): Promise<void> {
  if (pendingUpdates.size === 0 || !genAI) return;
  
  const updates = Array.from(pendingUpdates);
  pendingUpdates.clear();
  
  const index = getEmbeddingIndex();
  if (!index) {
    console.log("⚠️ Embedding index yok, incremental update atlandı");
    return;
  }
  
  console.log(`\n🔄 ${updates.length} dosya güncelleniyor...`);
  
  const chunksToAdd: EmbeddingChunk[] = [];
  const filesToRemove: Set<string> = new Set();
  
  for (const update of updates) {
    const [type, fullPath] = update.split(":", 2);
    
    if (type === "delete") {
      filesToRemove.add(fullPath);
      continue;
    }
    
    // For add/change: remove old chunks, add new ones
    filesToRemove.add(fullPath);
    
    try {
      const newChunks = await parseFileIntoChunks(fullPath);
      chunksToAdd.push(...newChunks);
    } catch (e) {
      console.log(`⚠️ Parse hatası: ${fullPath}`);
    }
  }
  
  // Remove old chunks for modified/deleted files
  const filteredChunks = index.chunks.filter(c => !filesToRemove.has(c.file));
  
  // Get embeddings for new chunks
  if (chunksToAdd.length > 0) {
    const texts = chunksToAdd.map(c => `${c.type} ${c.name || ""}: ${c.content.slice(0, 500)}`);
    const embeddings = await getEmbeddings(genAI, texts);
    
    for (let i = 0; i < chunksToAdd.length; i++) {
      chunksToAdd[i].embedding = embeddings[i];
    }
  }
  
  // Update index
  index.chunks = [...filteredChunks, ...chunksToAdd];
  index.lastUpdated = new Date();
  
  // Update file embeddings
  for (const file of filesToRemove) {
    index.fileEmbeddings.delete(file);
  }
  
  // Calculate new file embeddings
  const fileChunks = new Map<string, EmbeddingChunk[]>();
  for (const chunk of chunksToAdd) {
    const existing = fileChunks.get(chunk.file) || [];
    existing.push(chunk);
    fileChunks.set(chunk.file, existing);
  }
  
  for (const [file, fChunks] of fileChunks) {
    const avgEmbedding = new Array(768).fill(0);
    for (const chunk of fChunks) {
      if (chunk.embedding) {
        for (let i = 0; i < 768; i++) {
          avgEmbedding[i] += chunk.embedding[i] / fChunks.length;
        }
      }
    }
    index.fileEmbeddings.set(file, avgEmbedding);
  }
  
  // Save to disk
  saveEmbeddingIndex(rootDir);
  
  const relPaths = updates.map(u => path.relative(rootDir, u.split(":")[1]));
  console.log(`✅ Güncellendi: ${relPaths.join(", ")}`);
}

/**
 * Check if watcher is running
 */
export function isWatcherRunning(): boolean {
  return watcher !== null;
}

/**
 * Get watcher status
 */
export function getWatcherStatus(): string {
  if (!watcher) {
    return "❌ File watcher kapalı";
  }
  return `👁️ File watcher aktif (${pendingUpdates.size} bekleyen güncelleme)`;
}
