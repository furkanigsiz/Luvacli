/**
 * Docs Manager - Kullanıcı dökümanları yönetimi
 * 
 * Kullanıcılar docs/ klasörüne API dökümanları, SDK rehberleri vb. ekleyebilir.
 * Agent bu dökümanları okuyarak doğru implementasyon yapar.
 */

import * as fs from "fs";
import * as path from "path";

export interface DocFile {
  name: string;
  path: string;
  relativePath: string;
  content: string;
  keywords: string[];
  size: number;
}

export interface DocMatch {
  doc: DocFile;
  score: number;
  matchedKeywords: string[];
}

const DOCS_FOLDER = "docs";
const DOC_EXTENSIONS = [".md", ".txt", ".json", ".yaml", ".yml"];
const MAX_DOC_SIZE = 500000; // 500KB max per doc

// Popüler servis/API keyword mapping
const SERVICE_ALIASES: Record<string, string[]> = {
  iyzico: ["iyzipay", "iyzico", "ödeme", "payment", "checkout"],
  stripe: ["stripe", "payment", "checkout", "subscription"],
  firebase: ["firebase", "firestore", "realtime", "fcm", "push"],
  supabase: ["supabase", "postgres", "realtime", "auth"],
  aws: ["aws", "amazon", "s3", "lambda", "dynamodb", "cognito"],
  twilio: ["twilio", "sms", "whatsapp", "voice", "mesaj"],
  sendgrid: ["sendgrid", "email", "mail", "eposta"],
  cloudinary: ["cloudinary", "image", "upload", "cdn", "resim"],
  algolia: ["algolia", "search", "arama"],
  pusher: ["pusher", "websocket", "realtime", "socket"],
  redis: ["redis", "cache", "önbellek", "session"],
  mongodb: ["mongodb", "mongo", "nosql", "database"],
  prisma: ["prisma", "orm", "database", "migration"],
  nextauth: ["nextauth", "auth", "authentication", "login", "giriş"],
  clerk: ["clerk", "auth", "authentication", "user"],
};

/**
 * docs/ klasörünü tara ve tüm dökümanları yükle
 */
export function scanDocsFolder(cwd: string): DocFile[] {
  const docsPath = path.join(cwd, DOCS_FOLDER);
  
  if (!fs.existsSync(docsPath)) {
    return [];
  }
  
  const docs: DocFile[] = [];
  scanDirectory(docsPath, docsPath, docs);
  return docs;
}

function scanDirectory(dir: string, root: string, docs: DocFile[]): void {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      // Alt klasörleri de tara
      scanDirectory(fullPath, root, docs);
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase();
      if (DOC_EXTENSIONS.includes(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_DOC_SIZE) {
            const content = fs.readFileSync(fullPath, "utf-8");
            const relativePath = path.relative(root, fullPath);
            const keywords = extractKeywords(item.name, content);
            
            docs.push({
              name: item.name,
              path: fullPath,
              relativePath,
              content,
              keywords,
              size: stat.size
            });
          }
        } catch {}
      }
    }
  }
}

/**
 * Dosya adı ve içerikten keyword çıkar
 */
function extractKeywords(filename: string, content: string): string[] {
  const keywords: string[] = [];
  const filenameLower = filename.toLowerCase().replace(/\.[^.]+$/, "");
  const contentLower = content.toLowerCase();
  
  // Dosya adından keyword
  keywords.push(filenameLower);
  keywords.push(...filenameLower.split(/[-_.\s]+/));
  
  // Bilinen servis isimlerini kontrol et
  for (const [service, aliases] of Object.entries(SERVICE_ALIASES)) {
    for (const alias of aliases) {
      if (filenameLower.includes(alias) || contentLower.includes(alias)) {
        keywords.push(service, ...aliases);
        break;
      }
    }
  }
  
  // İçerikten önemli kelimeleri çıkar
  const importantPatterns = [
    /api[_-]?key/gi,
    /secret[_-]?key/gi,
    /endpoint/gi,
    /base[_-]?url/gi,
    /sdk/gi,
    /npm install ([a-z0-9@/-]+)/gi,
    /import .+ from ['"]([^'"]+)['"]/g,
  ];
  
  for (const pattern of importantPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      keywords.push(...matches.map(m => m.toLowerCase()));
    }
  }
  
  // Unique keywords
  return [...new Set(keywords.filter(k => k.length > 2))];
}

/**
 * Kullanıcı sorgusuna göre en uygun dökümanları bul
 */
export function findRelevantDocs(query: string, docs: DocFile[], maxResults = 3): DocMatch[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  const matches: DocMatch[] = [];
  
  for (const doc of docs) {
    let score = 0;
    const matchedKeywords: string[] = [];
    
    // Direkt keyword eşleşmesi
    for (const word of queryWords) {
      // Servis alias kontrolü
      for (const [service, aliases] of Object.entries(SERVICE_ALIASES)) {
        if (aliases.includes(word) || word.includes(service)) {
          if (doc.keywords.some(k => aliases.includes(k) || k.includes(service))) {
            score += 50;
            matchedKeywords.push(service);
          }
        }
      }
      
      // Keyword eşleşmesi
      for (const keyword of doc.keywords) {
        if (keyword.includes(word) || word.includes(keyword)) {
          score += 20;
          matchedKeywords.push(keyword);
        }
      }
      
      // İçerik eşleşmesi
      if (doc.content.toLowerCase().includes(word)) {
        score += 5;
      }
    }
    
    // Dosya adı eşleşmesi (yüksek öncelik)
    const docNameLower = doc.name.toLowerCase();
    for (const word of queryWords) {
      if (docNameLower.includes(word)) {
        score += 30;
        matchedKeywords.push(doc.name);
      }
    }
    
    if (score > 0) {
      matches.push({
        doc,
        score,
        matchedKeywords: [...new Set(matchedKeywords)]
      });
    }
  }
  
  // Score'a göre sırala ve limit uygula
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Döküman içeriğini context formatında döndür
 */
export function buildDocsContext(matches: DocMatch[]): string {
  if (matches.length === 0) return "";
  
  let context = "\n\n=== KULLANICI DÖKÜMANLARI ===\n";
  context += "Bu dökümanlar kullanıcının docs/ klasöründen alındı. ";
  context += "Implementasyon yaparken bu dökümanları referans al.\n";
  
  for (const match of matches) {
    context += `\n--- 📚 ${match.doc.relativePath} ---\n`;
    context += `Eşleşen: ${match.matchedKeywords.join(", ")}\n`;
    context += "```\n";
    
    // Çok uzun dökümanları truncate et
    if (match.doc.content.length > 50000) {
      context += match.doc.content.slice(0, 50000);
      context += "\n... [döküman çok uzun, kısaltıldı]\n";
    } else {
      context += match.doc.content;
    }
    
    context += "\n```\n";
  }
  
  return context;
}

/**
 * @docs mention'ı için parse
 */
export function parseDocsMention(message: string): { cleanMessage: string; docQuery: string | null } {
  // @docs:iyzico veya @docs:stripe gibi
  const docsRegex = /@docs:([^\s]+)/g;
  const match = docsRegex.exec(message);
  
  if (match) {
    return {
      cleanMessage: message.replace(match[0], "").trim(),
      docQuery: match[1]
    };
  }
  
  return { cleanMessage: message, docQuery: null };
}

/**
 * Docs klasörü durumunu göster
 */
export function getDocsStatus(cwd: string): string {
  const docs = scanDocsFolder(cwd);
  
  if (docs.length === 0) {
    return `📚 Docs: docs/ klasörü boş veya yok
   Kullanım: docs/ klasörüne API dökümanları ekle
   Örnek: docs/iyzico.md, docs/stripe-api.txt`;
  }
  
  let status = `📚 Docs: ${docs.length} döküman bulundu\n`;
  for (const doc of docs) {
    const sizeKB = Math.round(doc.size / 1024);
    status += `   • ${doc.relativePath} (${sizeKB}KB) - ${doc.keywords.slice(0, 5).join(", ")}\n`;
  }
  
  return status;
}

/**
 * Yeni döküman oluştur (template)
 */
export function createDocTemplate(cwd: string, serviceName: string): string {
  const docsPath = path.join(cwd, DOCS_FOLDER);
  
  // docs klasörü yoksa oluştur
  if (!fs.existsSync(docsPath)) {
    fs.mkdirSync(docsPath, { recursive: true });
  }
  
  const template = `# ${serviceName} Entegrasyon Dökümanı

## Kurulum
\`\`\`bash
npm install ${serviceName.toLowerCase()}
\`\`\`

## Konfigürasyon
\`\`\`typescript
// .env dosyasına ekle
${serviceName.toUpperCase()}_API_KEY=your_api_key
${serviceName.toUpperCase()}_SECRET_KEY=your_secret_key
\`\`\`

## Temel Kullanım
\`\`\`typescript
// Örnek kod buraya
\`\`\`

## API Endpoints
- POST /api/... - Açıklama
- GET /api/... - Açıklama

## Notlar
- Önemli bilgiler buraya
`;

  const filePath = path.join(docsPath, `${serviceName.toLowerCase()}.md`);
  fs.writeFileSync(filePath, template, "utf-8");
  
  return filePath;
}
