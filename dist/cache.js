/**
 * Context Caching - Gemini Context Caching API
 *
 * Reduces cost by caching static context (system prompt, steering, etc.)
 * https://ai.google.dev/gemini-api/docs/caching
 */
import * as crypto from "crypto";
// In-memory cache registry
let currentCache = null;
/**
 * Generate hash for content to detect changes
 */
function hashContent(content) {
    return crypto.createHash("md5").update(content).digest("hex");
}
/**
 * Create or get cached content
 */
export async function getOrCreateCache(genAI, model, systemPrompt, staticContext) {
    const fullContent = systemPrompt + staticContext;
    const contentHash = hashContent(fullContent);
    // Check if current cache is still valid
    if (currentCache && currentCache.contentHash === contentHash) {
        if (new Date() < currentCache.expireTime) {
            return { cacheName: currentCache.name, isNew: false };
        }
    }
    // Content changed or cache expired, create new cache
    try {
        const cacheManager = genAI.cacheManager;
        // Create new cached content
        const cachedContent = await cacheManager.create({
            model,
            contents: [
                {
                    role: "user",
                    parts: [{ text: fullContent }]
                },
                {
                    role: "model",
                    parts: [{ text: "Anladım. Bu context ile çalışmaya hazırım." }]
                }
            ],
            ttlSeconds: 3600, // 1 hour cache
            displayName: `luva-context-${Date.now()}`
        });
        currentCache = {
            name: cachedContent.name,
            contentHash,
            expireTime: new Date(Date.now() + 3600 * 1000)
        };
        console.log(`📦 Context cached (${Math.round(fullContent.length / 1000)}K chars)`);
        return { cacheName: cachedContent.name, isNew: true };
    }
    catch (error) {
        // Caching might not be available for all models
        console.log(`⚠️ Cache oluşturulamadı: ${error.message}`);
        return { cacheName: null, isNew: false };
    }
}
/**
 * Get model with cached content
 */
export async function getModelWithCache(genAI, model, cacheName) {
    const cacheManager = genAI.cacheManager;
    const cachedContent = await cacheManager.get(cacheName);
    return genAI.getGenerativeModelFromCachedContent(cachedContent);
}
/**
 * Delete current cache
 */
export async function deleteCache(genAI) {
    if (currentCache) {
        try {
            const cacheManager = genAI.cacheManager;
            await cacheManager.delete(currentCache.name);
            currentCache = null;
            console.log("🗑️ Cache silindi");
        }
        catch { }
    }
}
/**
 * Get cache stats
 */
export function getCacheStats() {
    if (!currentCache) {
        return { cached: false };
    }
    return {
        cached: true,
        expireTime: currentCache.expireTime,
        hash: currentCache.contentHash.slice(0, 8)
    };
}
