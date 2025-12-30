/**
 * Usage Tracking - Token/Credit kullanım takibi
 */

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  toolCalls: number;
  startTime: Date;
}

// Session usage tracker
let sessionUsage: UsageStats = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  toolCalls: 0,
  startTime: new Date()
};

/**
 * Reset usage stats (new session)
 */
export function resetUsage(): void {
  sessionUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    toolCalls: 0,
    startTime: new Date()
  };
}

/**
 * Add usage from a response
 */
export function addUsage(response: any): { prompt: number; completion: number; total: number } {
  const metadata = response?.usageMetadata;
  
  let prompt = 0;
  let completion = 0;
  
  if (metadata) {
    prompt = metadata.promptTokenCount || 0;
    completion = metadata.candidatesTokenCount || 0;
    
    sessionUsage.promptTokens += prompt;
    sessionUsage.completionTokens += completion;
    sessionUsage.totalTokens += prompt + completion;
  }
  
  sessionUsage.requestCount++;
  
  return { prompt, completion, total: prompt + completion };
}

/**
 * Add tool call count
 */
export function addToolCalls(count: number): void {
  sessionUsage.toolCalls += count;
}

/**
 * Get current usage stats
 */
export function getUsage(): UsageStats {
  return { ...sessionUsage };
}

/**
 * Format usage for display after each response
 */
export function formatResponseUsage(usage: { prompt: number; completion: number; total: number }): string {
  if (usage.total === 0) return "";
  return `\n📊 ${usage.total} token (↑${usage.prompt} ↓${usage.completion})`;
}

/**
 * Format session summary for exit
 */
export function formatSessionSummary(): string {
  const duration = Math.floor((Date.now() - sessionUsage.startTime.getTime()) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  
  let output = "\n╔════════════════════════════════════════╗\n";
  output += "║         📊 Session Özeti               ║\n";
  output += "╠════════════════════════════════════════╣\n";
  output += `║  ⏱️  Süre: ${minutes}m ${seconds}s`.padEnd(41) + "║\n";
  output += `║  📨 İstek: ${sessionUsage.requestCount}`.padEnd(41) + "║\n";
  output += `║  🛠️  Tool: ${sessionUsage.toolCalls}`.padEnd(41) + "║\n";
  output += "╠════════════════════════════════════════╣\n";
  output += `║  ↑ Input:      ${sessionUsage.promptTokens.toLocaleString().padStart(10)} token`.padEnd(41) + "║\n";
  output += `║  ↓ Output:     ${sessionUsage.completionTokens.toLocaleString().padStart(10)} token`.padEnd(41) + "║\n";
  output += `║  Σ Toplam:     ${sessionUsage.totalTokens.toLocaleString().padStart(10)} token`.padEnd(41) + "║\n";
  output += "╠════════════════════════════════════════╣\n";
  
  // Gemini 2.5 Pro pricing (per 1M tokens)
  // Input: $0.50/1M, Output: $3.00/1M (including thinking)
  const inputCost = (sessionUsage.promptTokens / 1_000_000) * 0.50;
  const outputCost = (sessionUsage.completionTokens / 1_000_000) * 3.00;
  const totalCost = inputCost + outputCost;
  
  output += `║  💰 Maliyet (Gemini 2.5 Pro):`.padEnd(41) + "║\n";
  output += `║     Input:  $${inputCost.toFixed(6)}`.padEnd(41) + "║\n";
  output += `║     Output: $${outputCost.toFixed(6)}`.padEnd(41) + "║\n";
  output += `║     Toplam: $${totalCost.toFixed(6)}`.padEnd(41) + "║\n";
  output += "╠════════════════════════════════════════╣\n";
  output += "║  📋 Fiyatlar (1M token):               ║\n";
  output += "║     Input: $0.50 | Output: $3.00      ║\n";
  output += "╚════════════════════════════════════════╝";
  
  return output;
}

/**
 * Get quick stats string
 */
export function getQuickStats(): string {
  return `📊 Session: ${sessionUsage.totalTokens.toLocaleString()} token | ${sessionUsage.requestCount} istek | ${sessionUsage.toolCalls} tool`;
}
