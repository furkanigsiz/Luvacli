/**
 * Retry Helper - Rate limit ve geçici hatalar için otomatik retry
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 5000,  // 5 saniye
  maxDelay: 60000,  // 60 saniye max
  onRetry: () => {}
};

/**
 * Rate limit hatasından bekleme süresini çıkar
 */
function extractRetryDelay(error: Error): number | null {
  const message = error.message || "";
  
  // "Please retry in 18.933647714s" formatını yakala
  const retryMatch = message.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (retryMatch) {
    return Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000; // +1s buffer
  }
  
  // "retryDelay":"18s" formatını yakala
  const jsonMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (jsonMatch) {
    return parseInt(jsonMatch[1]) * 1000 + 1000;
  }
  
  return null;
}

/**
 * Rate limit hatası mı kontrol et
 */
function isRateLimitError(error: Error): boolean {
  const message = error.message || "";
  return message.includes("429") || 
         message.includes("Too Many Requests") ||
         message.includes("quota") ||
         message.includes("rate limit") ||
         message.includes("RESOURCE_EXHAUSTED");
}

/**
 * Geçici hata mı kontrol et (retry yapılabilir)
 */
function isRetryableError(error: Error): boolean {
  const message = error.message || "";
  return isRateLimitError(error) ||
         message.includes("503") ||
         message.includes("500") ||
         message.includes("UNAVAILABLE") ||
         message.includes("INTERNAL") ||
         message.includes("timeout") ||
         message.includes("ECONNRESET") ||
         message.includes("ETIMEDOUT");
}

/**
 * Async fonksiyonu retry ile çalıştır
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Son deneme veya retry yapılamaz hata
      if (attempt > opts.maxRetries || !isRetryableError(error)) {
        throw error;
      }
      
      // Bekleme süresini hesapla
      let delay: number;
      
      if (isRateLimitError(error)) {
        // Rate limit için API'nin söylediği süreyi kullan
        const apiDelay = extractRetryDelay(error);
        delay = apiDelay || Math.min(opts.baseDelay * Math.pow(2, attempt - 1), opts.maxDelay);
      } else {
        // Diğer hatalar için exponential backoff
        delay = Math.min(opts.baseDelay * Math.pow(2, attempt - 1), opts.maxDelay);
      }
      
      opts.onRetry(attempt, delay, error);
      
      // Bekle
      await sleep(delay);
    }
  }
  
  throw lastError;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gemini API çağrısı için özel retry wrapper
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  return withRetry(fn, {
    maxRetries: 3,
    baseDelay: 5000,
    maxDelay: 120000, // 2 dakika max
    onRetry: (attempt, delay, error) => {
      const delaySeconds = Math.round(delay / 1000);
      const isRateLimit = isRateLimitError(error);
      
      if (isRateLimit) {
        console.log(`\n⏳ Rate limit aşıldı. ${delaySeconds}s bekleniyor... (deneme ${attempt}/3)`);
      } else {
        console.log(`\n⚠️ API hatası, ${delaySeconds}s sonra tekrar denenecek... (deneme ${attempt}/3)`);
      }
      
      if (context) {
        console.log(`   ${context}`);
      }
    }
  });
}

/**
 * Chat session sendMessage için wrapper
 */
export async function sendMessageWithRetry(
  chatSession: any,
  message: any,
  context?: string
): Promise<any> {
  return withGeminiRetry(
    () => chatSession.sendMessage(message),
    context
  );
}

/**
 * Model generateContent için wrapper
 */
export async function generateContentWithRetry(
  model: any,
  prompt: string,
  context?: string
): Promise<any> {
  return withGeminiRetry(
    () => model.generateContent(prompt),
    context
  );
}
