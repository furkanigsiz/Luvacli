/**
 * Smart Context - Cursor/Kiro tarzı akıllı context yönetimi
 * 
 * Combines:
 * 1. Embedding-based semantic search
 * 2. AST-based chunking
 * 3. Dependency graph
 * 4. Token budget management
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { chunkCodebase, getChunkSummary, EmbeddingChunk } from "./chunker.js";
import { indexWithEmbeddings, semanticSearch, getEmbeddingIndex, loadEmbeddingIndex } from "./embeddings.js";
import { buildDependencyGraph, getRelatedFiles, getGraphSummary, DependencyGraph } from "./dependency-graph.js";
import { buildSmartContext, ContextPriority, TOKEN_BUDGET } from "./context-optimizer.js";

export interface SmartContextIndex {
  chunks: EmbeddingChunk[];
  dependencyGraph: DependencyGraph;
  rootDir: string;
  lastUpdated: Date;
  summary: string;
}

let smartIndex: SmartContextIndex | null = null;

/**
 * Initialize smart context index
 */
export async function initSmartContext(
  genAI: GoogleGenerativeAI,
  rootDir: string,
  forceReindex: boolean = false
): Promise<SmartContextIndex> {
  // Try to load from cache first
  if (!forceReindex) {
    const cached = loadEmbeddingIndex(rootDir);
    if (cached) {
      console.log("🧠 Cache'den yükleniyor...");
      
      // Build dependency graph (fast, no API call)
      const dependencyGraph = buildDependencyGraph(rootDir);
      
      const summary = `🧠 Smart Context Ready (cached)\n` +
        `  📦 ${cached.chunks.length} chunk\n` +
        `  ${getGraphSummary(dependencyGraph)}`;
      
      smartIndex = {
        chunks: cached.chunks,
        dependencyGraph,
        rootDir,
        lastUpdated: cached.lastUpdated,
        summary
      };
      
      console.log("✅ Smart context hazır (cache'den)!");
      return smartIndex;
    }
  }
  
  console.log("🧠 Smart context oluşturuluyor...");
  
  // 1. Chunk codebase
  console.log("  📦 Dosyalar parçalanıyor...");
  const chunks = await chunkCodebase(rootDir);
  console.log(`  ${getChunkSummary(chunks)}`);
  
  // 2. Build dependency graph
  console.log("  🔗 Dependency graph oluşturuluyor...");
  const dependencyGraph = buildDependencyGraph(rootDir);
  console.log(`  ${getGraphSummary(dependencyGraph)}`);
  
  // 3. Create embeddings (this is the slow part)
  console.log("  🔍 Embeddings oluşturuluyor (ücretsiz)...");
  await indexWithEmbeddings(genAI, rootDir, chunks);
  
  const summary = `🧠 Smart Context Ready\n` +
    `  ${getChunkSummary(chunks)}\n` +
    `  ${getGraphSummary(dependencyGraph)}`;
  
  smartIndex = {
    chunks,
    dependencyGraph,
    rootDir,
    lastUpdated: new Date(),
    summary
  };
  
  console.log("✅ Smart context hazır!");
  
  return smartIndex;
}

/**
 * Get smart context for a query
 */
export async function getSmartContext(
  genAI: GoogleGenerativeAI,
  query: string,
  options: {
    activeFiles?: string[];
    mentionedFiles?: string[];
    maxTokens?: number;
  } = {}
): Promise<{ context: string; sources: string[]; stats: string }> {
  const maxTokens = options.maxTokens || TOKEN_BUDGET.relatedFiles + TOKEN_BUDGET.dependencies;
  const contextItems: ContextPriority[] = [];
  const sources: string[] = [];
  
  // 1. Add mentioned files (highest priority)
  if (options.mentionedFiles) {
    for (const file of options.mentionedFiles) {
      const fullPath = path.resolve(smartIndex?.rootDir || process.cwd(), file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        const tokens = Math.ceil(content.length / 4);
        contextItems.push({
          type: "mentioned",
          content: `--- ${file} ---\n${content}`,
          file,
          priority: 100,
          tokens
        });
        sources.push(`📎 ${file}`);
      }
    }
  }
  
  // 2. Add active files (high priority)
  if (options.activeFiles) {
    for (const file of options.activeFiles) {
      if (options.mentionedFiles?.includes(file)) continue;
      
      const fullPath = path.resolve(smartIndex?.rootDir || process.cwd(), file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        contextItems.push({
          type: "active",
          content: `--- ${file} (active) ---\n${content}`,
          file,
          priority: 90,
          tokens: Math.ceil(content.length / 4)
        });
        sources.push(`📂 ${file}`);
      }
    }
  }
  
  // 3. Semantic search (medium-high priority)
  if (smartIndex && getEmbeddingIndex()) {
    const semanticResults = await semanticSearch(genAI, query, 5);
    
    for (const { chunk, score } of semanticResults) {
      if (score < 0.3) continue; // Skip low relevance
      
      // Skip if already included
      if (contextItems.some(c => c.file === chunk.file)) continue;
      
      const tokens = Math.ceil(chunk.content.length / 4);
      contextItems.push({
        type: "semantic",
        content: `--- ${chunk.file}:${chunk.startLine}-${chunk.endLine} (${chunk.type}${chunk.name ? ` ${chunk.name}` : ""}) ---\n${chunk.content}`,
        file: chunk.file,
        priority: 70 + score * 20, // 70-90 based on score
        tokens
      });
      sources.push(`🔍 ${chunk.file}:${chunk.startLine} (${(score * 100).toFixed(0)}%)`);
    }
  }
  
  // 4. Dependencies of active/mentioned files (medium priority)
  if (smartIndex && (options.activeFiles?.length || options.mentionedFiles?.length)) {
    const targetFiles = [...(options.activeFiles || []), ...(options.mentionedFiles || [])];
    const addedDeps = new Set<string>();
    
    for (const file of targetFiles) {
      const related = getRelatedFiles(smartIndex.dependencyGraph, file);
      
      for (const dep of [...related.dependencies, ...related.dependents].slice(0, 3)) {
        if (addedDeps.has(dep) || contextItems.some(c => c.file === dep)) continue;
        addedDeps.add(dep);
        
        const fullPath = path.resolve(smartIndex.rootDir, dep);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          const tokens = Math.ceil(content.length / 4);
          
          // Truncate if too large
          const truncated = content.length > 3000 
            ? content.slice(0, 3000) + "\n... (truncated)"
            : content;
          
          contextItems.push({
            type: "dependency",
            content: `--- ${dep} (dependency) ---\n${truncated}`,
            file: dep,
            priority: 50,
            tokens: Math.ceil(truncated.length / 4)
          });
          sources.push(`🔗 ${dep}`);
        }
      }
    }
  }
  
  // 5. Apply token budget
  const { included, excluded, totalTokens } = buildSmartContext(contextItems, maxTokens);
  
  // Build final context string
  const context = included
    .sort((a, b) => b.priority - a.priority)
    .map(c => c.content)
    .join("\n\n");
  
  const stats = `📊 Context: ${included.length} kaynak, ~${totalTokens.toLocaleString()} token` +
    (excluded.length > 0 ? ` (${excluded.length} hariç tutuldu)` : "");
  
  return { context, sources: sources.slice(0, 10), stats };
}

/**
 * Get current smart index
 */
export function getSmartIndex(): SmartContextIndex | null {
  return smartIndex;
}

/**
 * Check if smart index is ready
 */
export function isSmartIndexReady(): boolean {
  return smartIndex !== null && getEmbeddingIndex() !== null;
}

/**
 * Format smart context info
 */
export function formatSmartContextInfo(): string {
  if (!smartIndex) {
    return "❌ Smart context henüz oluşturulmadı. 'smart index' komutu ile oluştur.";
  }
  
  const embeddingIndex = getEmbeddingIndex();
  
  let output = "🧠 Smart Context Status\n\n";
  output += `📦 Chunks: ${smartIndex.chunks.length}\n`;
  output += `🔗 Files in graph: ${smartIndex.dependencyGraph.nodes.size}\n`;
  output += `🔍 Embeddings: ${embeddingIndex ? "✅ Ready" : "❌ Not ready"}\n`;
  output += `⏰ Last updated: ${smartIndex.lastUpdated.toLocaleTimeString()}\n`;
  
  return output;
}
