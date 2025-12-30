/**
 * Embeddings - Gemini Embedding API ile semantic search
 *
 * Gemini embedding ücretsiz!
 * Model: text-embedding-004
 */
import * as fs from "fs";
import * as path from "path";
const CACHE_VERSION = 1;
// In-memory embedding index
let embeddingIndex = null;
/**
 * Get cache file path for a project
 */
function getCachePath(rootDir) {
    return path.join(rootDir, ".luva", "cache", "embeddings.json");
}
/**
 * Save embedding index to disk
 */
export function saveEmbeddingIndex(rootDir) {
    if (!embeddingIndex)
        return false;
    const cachePath = getCachePath(rootDir);
    const cacheDir = path.dirname(cachePath);
    try {
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const serialized = {
            chunks: embeddingIndex.chunks,
            fileEmbeddings: Array.from(embeddingIndex.fileEmbeddings.entries()),
            lastUpdated: embeddingIndex.lastUpdated.toISOString(),
            version: CACHE_VERSION
        };
        fs.writeFileSync(cachePath, JSON.stringify(serialized));
        console.log(`💾 Embedding index kaydedildi: ${cachePath}`);
        return true;
    }
    catch (e) {
        console.error(`❌ Index kaydetme hatası: ${e}`);
        return false;
    }
}
/**
 * Load embedding index from disk
 */
export function loadEmbeddingIndex(rootDir) {
    const cachePath = getCachePath(rootDir);
    if (!fs.existsSync(cachePath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(cachePath, "utf-8");
        const serialized = JSON.parse(content);
        // Version check
        if (serialized.version !== CACHE_VERSION) {
            console.log("⚠️ Eski cache versiyonu, yeniden indexleme gerekli");
            return null;
        }
        embeddingIndex = {
            chunks: serialized.chunks,
            fileEmbeddings: new Map(serialized.fileEmbeddings),
            lastUpdated: new Date(serialized.lastUpdated)
        };
        const age = Date.now() - embeddingIndex.lastUpdated.getTime();
        const ageMinutes = Math.floor(age / 60000);
        console.log(`📂 Embedding index yüklendi (${embeddingIndex.chunks.length} chunk, ${ageMinutes} dk önce)`);
        return embeddingIndex;
    }
    catch (e) {
        console.error(`❌ Index yükleme hatası: ${e}`);
        return null;
    }
}
/**
 * Get embeddings from Gemini (FREE!)
 */
export async function getEmbeddings(genAI, texts) {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    const embeddings = [];
    // Batch process (max 100 at a time)
    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        for (const text of batch) {
            try {
                const result = await model.embedContent(text);
                embeddings.push(result.embedding.values);
            }
            catch (e) {
                // Fallback: zero vector
                embeddings.push(new Array(768).fill(0));
            }
        }
    }
    return embeddings;
}
/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}
/**
 * Search for most similar chunks
 */
export async function semanticSearch(genAI, query, topK = 10) {
    if (!embeddingIndex || embeddingIndex.chunks.length === 0) {
        return [];
    }
    // Get query embedding
    const [queryEmbedding] = await getEmbeddings(genAI, [query]);
    // Calculate similarities
    const results = [];
    for (const chunk of embeddingIndex.chunks) {
        if (!chunk.embedding)
            continue;
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        results.push({ chunk, score });
    }
    // Sort by score and return top K
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
/**
 * Index a codebase with embeddings
 */
export async function indexWithEmbeddings(genAI, rootDir, chunks) {
    console.log(`🔍 ${chunks.length} chunk embedding oluşturuluyor...`);
    // Get embeddings for all chunks
    const texts = chunks.map(c => `${c.type} ${c.name || ""}: ${c.content.slice(0, 500)}`);
    const embeddings = await getEmbeddings(genAI, texts);
    // Assign embeddings to chunks
    for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = embeddings[i];
    }
    // Create file-level embeddings
    const fileEmbeddings = new Map();
    const fileChunks = new Map();
    for (const chunk of chunks) {
        const existing = fileChunks.get(chunk.file) || [];
        existing.push(chunk);
        fileChunks.set(chunk.file, existing);
    }
    for (const [file, fChunks] of fileChunks) {
        // Average embeddings for file
        const avgEmbedding = new Array(768).fill(0);
        for (const chunk of fChunks) {
            if (chunk.embedding) {
                for (let i = 0; i < 768; i++) {
                    avgEmbedding[i] += chunk.embedding[i] / fChunks.length;
                }
            }
        }
        fileEmbeddings.set(file, avgEmbedding);
    }
    embeddingIndex = {
        chunks,
        fileEmbeddings,
        lastUpdated: new Date()
    };
    // Save to disk
    saveEmbeddingIndex(rootDir);
    console.log(`✅ Embedding index oluşturuldu: ${chunks.length} chunk, ${fileEmbeddings.size} dosya`);
    return embeddingIndex;
}
/**
 * Get current embedding index
 */
export function getEmbeddingIndex() {
    return embeddingIndex;
}
/**
 * Find most relevant files for a query
 */
export async function findRelevantFiles(genAI, query, topK = 5) {
    if (!embeddingIndex)
        return [];
    const [queryEmbedding] = await getEmbeddings(genAI, [query]);
    const results = [];
    for (const [file, embedding] of embeddingIndex.fileEmbeddings) {
        const score = cosineSimilarity(queryEmbedding, embedding);
        results.push({ file, score });
    }
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
