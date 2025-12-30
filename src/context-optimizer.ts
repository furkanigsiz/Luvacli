/**
 * Context Optimizer - Token kullanımını azaltmak için
 * 
 * Strategies:
 * 1. History summarization - Eski mesajları özetle
 * 2. Context deduplication - Tekrar eden içeriği kaldır
 * 3. Smart truncation - Gereksiz kısımları kes
 * 4. Token budget management - Öncelikli context seçimi
 */

import { Content } from "@google/generative-ai";

// Token budget configuration
export const TOKEN_BUDGET = {
  total: 100000,           // Gemini 2.5 Pro context window
  systemPrompt: 5000,      // System prompt + steering
  history: 30000,          // Conversation history
  activeFiles: 20000,      // Currently open/mentioned files
  relatedFiles: 30000,     // Semantic search results
  dependencies: 15000,     // Import chain files
};

// Approximate token count (rough estimate: 4 chars = 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getTextFromParts(parts: any[]): string {
  return parts
    .filter(p => p.text)
    .map(p => p.text)
    .join("\n");
}

/**
 * Smart context builder with token budget
 */
export interface ContextPriority {
  type: "system" | "steering" | "active" | "mentioned" | "related" | "semantic" | "dependency";
  content: string;
  file?: string;
  priority: number; // Higher = more important
  tokens: number;
}

export function buildSmartContext(
  items: ContextPriority[],
  maxTokens: number = TOKEN_BUDGET.total
): { included: ContextPriority[]; excluded: ContextPriority[]; totalTokens: number } {
  // Sort by priority (descending)
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  
  const included: ContextPriority[] = [];
  const excluded: ContextPriority[] = [];
  let totalTokens = 0;
  
  for (const item of sorted) {
    if (totalTokens + item.tokens <= maxTokens) {
      included.push(item);
      totalTokens += item.tokens;
    } else {
      excluded.push(item);
    }
  }
  
  return { included, excluded, totalTokens };
}

/**
 * Optimize history to fit within token budget
 */
export function optimizeHistory(
  history: Content[],
  maxTokens: number = 50000
): Content[] {
  if (history.length === 0) return history;
  
  // Calculate current token usage
  let totalTokens = 0;
  const tokenCounts: number[] = [];
  
  for (const msg of history) {
    const text = getTextFromParts(msg.parts || []);
    const tokens = estimateTokens(text);
    tokenCounts.push(tokens);
    totalTokens += tokens;
  }
  
  // If within budget, return as-is
  if (totalTokens <= maxTokens) {
    return history;
  }
  
  console.log(`⚠️ History çok büyük (${totalTokens} token), optimize ediliyor...`);
  
  // Strategy 1: Keep last N messages that fit
  const optimized: Content[] = [];
  let usedTokens = 0;
  
  // Always keep first message (usually important context)
  if (history.length > 0) {
    optimized.push(history[0]);
    usedTokens += tokenCounts[0];
  }
  
  // Add messages from end until budget is reached
  for (let i = history.length - 1; i > 0; i--) {
    if (usedTokens + tokenCounts[i] > maxTokens) {
      break;
    }
    optimized.splice(1, 0, history[i]); // Insert after first message
    usedTokens += tokenCounts[i];
  }
  
  console.log(`✅ History optimize edildi: ${history.length} → ${optimized.length} mesaj (${usedTokens} token)`);
  
  return optimized;
}

/**
 * Summarize old history messages
 */
export function summarizeOldHistory(history: Content[], keepLast: number = 10): {
  summary: string;
  recentHistory: Content[];
} {
  if (history.length <= keepLast) {
    return { summary: "", recentHistory: history };
  }
  
  const oldMessages = history.slice(0, -keepLast);
  const recentHistory = history.slice(-keepLast);
  
  // Create summary of old messages
  let summary = "## Önceki Konuşma Özeti\n\n";
  
  for (const msg of oldMessages) {
    const text = getTextFromParts(msg.parts || []);
    const role = msg.role === "user" ? "Kullanıcı" : "Asistan";
    
    // Truncate long messages
    const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
    summary += `- ${role}: ${truncated.replace(/\n/g, " ")}\n`;
  }
  
  return { summary, recentHistory };
}

/**
 * Remove redundant context from messages
 */
export function deduplicateContext(history: Content[]): Content[] {
  const seenContent = new Set<string>();
  
  return history.map(msg => {
    const parts = msg.parts || [];
    const dedupedParts = parts.filter(part => {
      if (!part.text) return true; // Keep non-text parts
      
      // Skip if we've seen this exact content before
      const hash = part.text.slice(0, 500); // Use first 500 chars as key
      if (seenContent.has(hash)) {
        return false;
      }
      seenContent.add(hash);
      return true;
    });
    
    return { ...msg, parts: dedupedParts };
  }).filter(msg => msg.parts && msg.parts.length > 0);
}

/**
 * Truncate file content in context
 */
export function truncateFileContent(content: string, maxLines: number = 100): string {
  const lines = content.split("\n");
  
  if (lines.length <= maxLines) {
    return content;
  }
  
  // Keep first and last portions
  const keepStart = Math.floor(maxLines * 0.6);
  const keepEnd = maxLines - keepStart;
  
  const start = lines.slice(0, keepStart);
  const end = lines.slice(-keepEnd);
  
  return [
    ...start,
    `\n... (${lines.length - maxLines} satır atlandı) ...\n`,
    ...end
  ].join("\n");
}

/**
 * Get context optimization stats
 */
export function getContextStats(history: Content[], systemPrompt: string): {
  historyTokens: number;
  systemTokens: number;
  totalTokens: number;
  messageCount: number;
} {
  let historyTokens = 0;
  
  for (const msg of history) {
    const text = getTextFromParts(msg.parts || []);
    historyTokens += estimateTokens(text);
  }
  
  const systemTokens = estimateTokens(systemPrompt);
  
  return {
    historyTokens,
    systemTokens,
    totalTokens: historyTokens + systemTokens,
    messageCount: history.length
  };
}
