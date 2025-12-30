import * as fs from "fs";
import * as path from "path";

/**
 * Kiro-style file references: #[[file:path/to/file]]
 * Spec içinde dış dosyalara referans verme
 */
export interface FileReference {
  pattern: string;      // #[[file:openapi.yaml]]
  path: string;         // openapi.yaml
  content?: string;     // Dosya içeriği (lazy load)
}

/**
 * Parse #[[file:...]] references from spec content
 */
export function parseFileReferences(content: string, cwd: string): FileReference[] {
  const refs: FileReference[] = [];
  const regex = /#\[\[file:([^\]]+)\]\]/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const filePath = match[1].trim();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    
    let fileContent: string | undefined;
    try {
      if (fs.existsSync(fullPath)) {
        fileContent = fs.readFileSync(fullPath, "utf-8");
      }
    } catch {}
    
    refs.push({
      pattern: match[0],
      path: filePath,
      content: fileContent
    });
  }
  
  return refs;
}

/**
 * Expand file references in content
 */
export function expandFileReferences(content: string, cwd: string): string {
  const refs = parseFileReferences(content, cwd);
  let expanded = content;
  
  for (const ref of refs) {
    if (ref.content) {
      const replacement = `\n\`\`\`${path.extname(ref.path).slice(1) || "txt"}\n// ${ref.path}\n${ref.content}\n\`\`\`\n`;
      expanded = expanded.replace(ref.pattern, replacement);
    } else {
      expanded = expanded.replace(ref.pattern, `[File not found: ${ref.path}]`);
    }
  }
  
  return expanded;
}

/**
 * Get referenced files from spec
 */
export function getSpecReferences(spec: Spec, cwd: string): FileReference[] {
  const allContent = [
    spec.description,
    ...spec.requirements.map(r => r.description + " " + r.acceptance.join(" ")),
    ...spec.design.map(d => d.description + " " + d.rationale),
    ...spec.tasks.map(t => t.description)
  ].join("\n");
  
  return parseFileReferences(allContent, cwd);
}

export interface Requirement {
  id: string;
  category?: string;
  priority?: "P0" | "P1" | "P2";
  description: string;
  acceptance: string[];
}

export interface DesignDecision {
  id: string;
  category?: string;
  component: string;
  description: string;
  rationale: string;
  alternatives?: string;
}

export interface Task {
  id: string;
  category?: string;
  title: string;
  description: string;
  file?: string;
  status: "pending" | "in-progress" | "done" | "skipped";
  requirementIds: string[];
  dependsOn?: string[];
  size?: "small" | "medium" | "large";
}

export interface Spec {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "requirements" | "design" | "tasks" | "implementing" | "done";
  requirements: Requirement[];
  design: DesignDecision[];
  tasks: Task[];
  references?: string[];  // Kiro-style: #[[file:openapi.yaml]] paths
}

const SPEC_DIR = ".luva/specs";

// Initialize spec directory
export function initSpecDir(cwd: string): void {
  const specDir = path.join(cwd, SPEC_DIR);
  if (!fs.existsSync(specDir)) {
    fs.mkdirSync(specDir, { recursive: true });
  }
}

// Create new spec
export function createSpec(cwd: string, title: string, description: string): Spec {
  initSpecDir(cwd);
  
  // Parse file references from description
  const refs = parseFileReferences(description, cwd);
  const referencePaths = refs.map(r => r.path);
  
  // Generate Kiro-style slug ID from title
  const id = generateSpecId(title, cwd);
  const spec: Spec = {
    id,
    title,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "draft",
    requirements: [],
    design: [],
    tasks: [],
    references: referencePaths.length > 0 ? referencePaths : undefined
  };
  
  saveSpec(cwd, spec);
  saveSpecMarkdown(cwd, spec);
  
  return spec;
}

/**
 * Generate Kiro-style spec ID from title
 * "User Authentication System" -> "user-authentication-system"
 * "İyzico Ödeme Entegrasyonu" -> "iyzico-odeme-entegrasyonu"
 */
function generateSpecId(title: string, cwd: string): string {
  // Turkish character mapping
  const trMap: Record<string, string> = {
    'ç': 'c', 'Ç': 'c',
    'ğ': 'g', 'Ğ': 'g',
    'ı': 'i', 'İ': 'i',
    'ö': 'o', 'Ö': 'o',
    'ş': 's', 'Ş': 's',
    'ü': 'u', 'Ü': 'u'
  };
  
  let slug = title
    .toLowerCase()
    .split('')
    .map(char => trMap[char] || char)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-')          // Spaces to hyphens
    .replace(/-+/g, '-')           // Multiple hyphens to single
    .replace(/^-|-$/g, '')         // Trim hyphens
    .slice(0, 50);                 // Max 50 chars
  
  // Ensure unique - check if exists and add number if needed
  const specDir = path.join(cwd, SPEC_DIR);
  let finalId = slug;
  let counter = 1;
  
  while (fs.existsSync(path.join(specDir, `${finalId}.json`))) {
    finalId = `${slug}-${counter}`;
    counter++;
  }
  
  return finalId;
}

// Save spec as JSON
export function saveSpec(cwd: string, spec: Spec): void {
  initSpecDir(cwd);
  spec.updatedAt = new Date().toISOString();
  const filePath = path.join(cwd, SPEC_DIR, `${spec.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(spec, null, 2));
}

// Save spec as Markdown (human-readable)
export function saveSpecMarkdown(cwd: string, spec: Spec): void {
  initSpecDir(cwd);
  
  let md = `# ${spec.title}\n\n`;
  md += `> ${spec.description}\n\n`;
  md += `**Status:** ${spec.status} | **Updated:** ${spec.updatedAt}\n\n`;
  md += `---\n\n`;
  
  // Requirements
  md += `## 📋 Requirements\n\n`;
  if (spec.requirements.length === 0) {
    md += `_No requirements defined yet_\n\n`;
  } else {
    // Group by category
    const categories = [...new Set(spec.requirements.map(r => r.category || "general"))];
    for (const cat of categories) {
      const catReqs = spec.requirements.filter(r => (r.category || "general") === cat);
      md += `### ${cat.toUpperCase()}\n\n`;
      for (const req of catReqs) {
        const priority = req.priority ? `[${req.priority}]` : "";
        md += `#### ${req.id}: ${req.description} ${priority}\n\n`;
        md += `**Acceptance Criteria:**\n`;
        for (const ac of req.acceptance) {
          md += `- [ ] ${ac}\n`;
        }
        md += `\n`;
      }
    }
  }
  
  // Design
  md += `## 🎨 Design\n\n`;
  if (spec.design.length === 0) {
    md += `_No design decisions yet_\n\n`;
  } else {
    const categories = [...new Set(spec.design.map(d => d.category || "general"))];
    for (const cat of categories) {
      const catDesign = spec.design.filter(d => (d.category || "general") === cat);
      md += `### ${cat.toUpperCase()}\n\n`;
      for (const d of catDesign) {
        md += `#### ${d.id}: ${d.component}\n\n`;
        md += `${d.description}\n\n`;
        md += `**Rationale:** ${d.rationale}\n\n`;
        if (d.alternatives) md += `**Alternatives considered:** ${d.alternatives}\n\n`;
      }
    }
  }
  
  // Tasks
  md += `## ✅ Tasks\n\n`;
  if (spec.tasks.length === 0) {
    md += `_No tasks defined yet_\n\n`;
  } else {
    const categories = [...new Set(spec.tasks.map(t => t.category || "general"))];
    for (const cat of categories) {
      const catTasks = spec.tasks.filter(t => (t.category || "general") === cat);
      md += `### ${cat.toUpperCase()}\n\n`;
      for (const task of catTasks) {
        const checkbox = task.status === "done" ? "[x]" : "[ ]";
        const statusIcon = task.status === "done" ? "✅" : task.status === "in-progress" ? "🔄" : "⏳";
        const size = task.size ? `(${task.size})` : "";
        md += `- ${checkbox} **${task.id}:** ${task.title} ${statusIcon} ${size}\n`;
        md += `  - ${task.description}\n`;
        if (task.file) md += `  - 📁 File: \`${task.file}\`\n`;
        if (task.dependsOn?.length) md += `  - ⏮️ Depends on: ${task.dependsOn.join(", ")}\n`;
        md += `\n`;
      }
    }
  }
  
  const filePath = path.join(cwd, SPEC_DIR, `${spec.id}.md`);
  fs.writeFileSync(filePath, md);
}

// Load spec by ID
export function loadSpec(cwd: string, specId: string): Spec | null {
  const filePath = path.join(cwd, SPEC_DIR, `${specId}.json`);
  if (!fs.existsSync(filePath)) return null;
  
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// List all specs
export function listSpecs(cwd: string): Spec[] {
  const specDir = path.join(cwd, SPEC_DIR);
  if (!fs.existsSync(specDir)) return [];
  
  const specs: Spec[] = [];
  const files = fs.readdirSync(specDir).filter(f => f.endsWith(".json"));
  
  for (const file of files) {
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(specDir, file), "utf-8"));
      specs.push(spec);
    } catch {}
  }
  
  return specs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

// Get active spec (most recent non-done)
export function getActiveSpec(cwd: string): Spec | null {
  const specs = listSpecs(cwd);
  return specs.find(s => s.status !== "done") || null;
}

// Update task status
export function updateTaskStatus(cwd: string, specId: string, taskId: string, status: Task["status"]): Spec | null {
  const spec = loadSpec(cwd, specId);
  if (!spec) return null;
  
  const task = spec.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    
    // Update spec status based on tasks
    const allDone = spec.tasks.every(t => t.status === "done" || t.status === "skipped");
    const anyInProgress = spec.tasks.some(t => t.status === "in-progress");
    
    if (allDone && spec.tasks.length > 0) {
      spec.status = "done";
    } else if (anyInProgress) {
      spec.status = "implementing";
    }
    
    saveSpec(cwd, spec);
    saveSpecMarkdown(cwd, spec);
  }
  
  return spec;
}

// Format spec for display
export function formatSpec(spec: Spec): string {
  const statusIcons: Record<string, string> = {
    draft: "📝",
    requirements: "📋",
    design: "🎨",
    tasks: "✅",
    implementing: "🔨",
    done: "✅"
  };
  
  let output = `\n${statusIcons[spec.status]} **${spec.title}** [${spec.status}]\n`;
  output += `   ${spec.description}\n\n`;
  
  if (spec.requirements.length > 0) {
    output += `📋 Requirements (${spec.requirements.length}):\n`;
    for (const req of spec.requirements) {
      output += `   • ${req.id}: ${req.description}\n`;
    }
    output += "\n";
  }
  
  if (spec.design.length > 0) {
    output += `🎨 Design (${spec.design.length}):\n`;
    for (const d of spec.design) {
      output += `   • ${d.component}: ${d.description.slice(0, 50)}...\n`;
    }
    output += "\n";
  }
  
  if (spec.tasks.length > 0) {
    const done = spec.tasks.filter(t => t.status === "done").length;
    output += `✅ Tasks (${done}/${spec.tasks.length}):\n`;
    for (const task of spec.tasks) {
      const icon = task.status === "done" ? "✅" : task.status === "in-progress" ? "🔄" : "⏳";
      output += `   ${icon} ${task.id}: ${task.title}\n`;
    }
  }
  
  return output;
}

// Format specs list
export function formatSpecsList(specs: Spec[]): string {
  if (specs.length === 0) {
    return "📋 Henüz spec yok. `/spec new <başlık>` ile oluştur.";
  }
  
  let output = "📋 Specs:\n\n";
  for (const spec of specs) {
    const statusIcons: Record<string, string> = {
      draft: "📝", requirements: "📋", design: "🎨", 
      tasks: "✅", implementing: "🔨", done: "✅"
    };
    const done = spec.tasks.filter(t => t.status === "done").length;
    output += `${statusIcons[spec.status]} ${spec.title} [${spec.status}]`;
    if (spec.tasks.length > 0) output += ` (${done}/${spec.tasks.length} tasks)`;
    output += `\n   ID: ${spec.id}\n\n`;
  }
  
  return output;
}

// Generate prompt for AI to create requirements
export function getRequirementsPrompt(spec: Spec, codebaseContext: string, cwd?: string): string {
  // Expand file references if cwd provided
  let expandedDescription = spec.description;
  let referencesContext = "";
  
  if (cwd && spec.references && spec.references.length > 0) {
    const refs = spec.references.map(refPath => {
      const fullPath = path.join(cwd, refPath);
      try {
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          const ext = path.extname(refPath).slice(1) || "txt";
          return `\n### Referenced: ${refPath}\n\`\`\`${ext}\n${content.slice(0, 5000)}\n\`\`\``;
        }
      } catch {}
      return "";
    }).filter(Boolean).join("\n");
    
    if (refs) {
      referencesContext = `\n## Referenced Files\n${refs}\n`;
    }
  }
  
  // Also expand inline references
  if (cwd) {
    expandedDescription = expandFileReferences(spec.description, cwd);
  }

  return `Sen dünya çapında deneyimli bir Senior Software Architect'sin. 10+ yıl enterprise projelerinde çalıştın.

PROJE: ${spec.title}
AÇIKLAMA: ${expandedDescription}
${referencesContext}
${codebaseContext}

Bu proje için KAPSAMLI bir requirements analizi yap. Bir enterprise projede olması gereken TÜM gereksinimleri düşün:

## Düşünmen Gereken Alanlar:

### 1. KULLANICI YÖNETİMİ
- Authentication (Login, Register, Forgot Password, Email Verification)
- Authorization (Roller, İzinler)
- Profil yönetimi
- Session management

### 2. GÜVENLİK
- Input validation
- XSS/CSRF koruması
- Rate limiting
- Data encryption
- HTTPS
- SQL injection koruması

### 3. KULLANICI DENEYİMİ (UX)
- Responsive design
- Loading states
- Error handling & messages
- Accessibility (a11y)
- SEO

### 4. PERFORMANS
- Lazy loading
- Caching stratejisi
- Image optimization
- Code splitting

### 5. VERİ YÖNETİMİ
- Database schema
- Data validation
- Backup stratejisi
- GDPR uyumluluğu
/spec new Organik Market E-Ticaret
> Kullanıcılar ürünleri görebilecek, sepete ekleyebilecek, 
> online ödeme yapabilecek. Admin paneli olacak.
### 6. ENTEGRASYONLAR
- Ödeme sistemi
- Email servisi
- Analytics
- 3rd party API'ler

### 7. ADMIN PANELİ
- Dashboard
- Kullanıcı yönetimi
- İçerik yönetimi
- Raporlama

### 8. DEPLOYMENT & OPS
- CI/CD
- Monitoring
- Logging
- Error tracking

Her requirement için:
1. Net ve ölçülebilir açıklama
2. Detaylı acceptance criteria
3. Öncelik seviyesi (P0: kritik, P1: önemli, P2: nice-to-have)

JSON formatında döndür:
{
  "requirements": [
    {
      "id": "REQ-1",
      "category": "auth",
      "priority": "P0",
      "description": "Kullanıcı email ve şifre ile kayıt olabilmeli",
      "acceptance": [
        "Email formatı validate edilmeli",
        "Şifre en az 8 karakter, 1 büyük harf, 1 rakam içermeli",
        "Email verification maili gönderilmeli",
        "Duplicate email kontrolü yapılmalı",
        "Başarılı kayıtta otomatik login olmalı"
      ]
    }
  ]
}

ÖNEMLİ: Eksik bırakma! Production-ready bir uygulama için gereken TÜM gereksinimleri listele. Minimum 15-20 requirement olmalı.

Sadece JSON döndür.`;
}

// Generate prompt for AI to create design
export function getDesignPrompt(spec: Spec, codebaseContext: string): string {
  const reqList = spec.requirements.map(r => `- [${r.id}] ${r.description}`).join("\n");
  
  return `Sen dünya çapında deneyimli bir Senior Software Architect'sin.

PROJE: ${spec.title}

REQUIREMENTS:
${reqList}

${codebaseContext}

Bu requirements için KAPSAMLI bir teknik tasarım oluştur. Her kararın arkasındaki mantığı açıkla.

## Tasarım Kararları İçin Düşün:

### 1. MİMARİ
- Frontend framework ve yapısı
- Backend yapısı (API design)
- Database seçimi ve schema
- State management stratejisi

### 2. KLASÖR YAPISI
- Feature-based organization
- Shared components
- Utils ve helpers
- Types ve interfaces

### 3. COMPONENT TASARIMI
- Atomic design principles
- Reusable components
- Props ve state yönetimi
- Error boundaries

### 4. DATA FLOW
- API layer
- Caching stratejisi
- Optimistic updates
- Real-time updates (gerekirse)

### 5. GÜVENLİK TASARIMI
- Auth flow (JWT, sessions, etc.)
- API security
- Frontend security
- Data validation layers

### 6. UI/UX TASARIMI
- Design system
- Responsive breakpoints
- Theme/styling approach
- Accessibility patterns

Her design decision için:
1. Component/modül adı
2. Detaylı açıklama
3. Neden bu yaklaşım seçildi (rationale)
4. Alternatifler ve neden reddedildi

JSON formatında döndür:
{
  "design": [
    {
      "id": "DES-1",
      "category": "architecture",
      "component": "AuthContext",
      "description": "Global authentication state yönetimi için React Context. User bilgisi, login/logout fonksiyonları, loading state içerir.",
      "rationale": "Redux overkill olur bu proje için. Context + useReducer yeterli. Prop drilling'den kaçınmak için global state gerekli.",
      "alternatives": "Redux Toolkit, Zustand - daha küçük proje için gereksiz complexity"
    }
  ]
}

ÖNEMLİ: Her requirement'ı karşılayacak tasarım kararları olmalı. Minimum 10-15 design decision.

Sadece JSON döndür.`;
}

// Generate prompt for AI to create tasks
export function getTasksPrompt(spec: Spec, codebaseContext: string): string {
  const reqList = spec.requirements.map(r => `- [${r.id}] ${r.description}`).join("\n");
  const designList = spec.design.map(d => `- [${d.id}] ${d.component}: ${d.description.slice(0, 100)}...`).join("\n");
  
  return `Sen dünya çapında deneyimli bir Tech Lead'sin. Projeyi implementasyon task'larına böleceksin.

PROJE: ${spec.title}

REQUIREMENTS:
${reqList}

DESIGN DECISIONS:
${designList}

${codebaseContext}

Bu tasarımı UYGULANABILIR task'lara böl. Her task:
- Tek bir PR'da tamamlanabilir boyutta olmalı
- Bağımlılıkları net olmalı
- Test edilebilir olmalı

## Task Kategorileri:

### 1. SETUP & CONFIG
- Proje kurulumu
- Dependencies
- Config dosyaları
- Environment variables

### 2. DATABASE & MODELS
- Schema oluşturma
- Migrations
- Seed data

### 3. API LAYER
- Endpoints
- Middleware
- Validation

### 4. AUTH SYSTEM
- Login/Register
- JWT/Session
- Protected routes

### 5. CORE FEATURES
- Ana özellikler
- CRUD işlemleri
- Business logic

### 6. UI COMPONENTS
- Layout components
- Form components
- Shared components

### 7. PAGES/VIEWS
- Her sayfa için task
- Routing

### 8. INTEGRATION
- 3rd party services
- Payment
- Email

### 9. TESTING
- Unit tests
- Integration tests
- E2E tests

### 10. POLISH & DEPLOY
- Error handling
- Loading states
- Performance optimization
- Deployment config

Her task için:
1. Net başlık
2. Detaylı açıklama (ne yapılacak, nasıl yapılacak)
3. Hangi dosya(lar)da çalışılacak
4. Hangi requirement'ları karşılıyor
5. Bağımlılıklar (hangi task'lardan sonra yapılmalı)
6. Tahmini süre (small/medium/large)

JSON formatında döndür:
{
  "tasks": [
    {
      "id": "TASK-1",
      "category": "setup",
      "title": "Proje kurulumu ve temel yapı",
      "description": "Vite + React + TypeScript projesi oluştur. TailwindCSS, React Router, React Query ekle. Klasör yapısını oluştur: src/components, src/pages, src/hooks, src/services, src/types, src/utils",
      "file": "package.json, vite.config.ts, tailwind.config.js",
      "requirementIds": [],
      "dependsOn": [],
      "size": "medium"
    }
  ]
}

ÖNEMLİ: 
- Task'lar mantıklı sırada olmalı (bağımlılıklar)
- Her task tek başına test edilebilir olmalı
- Minimum 20-30 task olmalı
- İlk task'lar setup, son task'lar polish olmalı

Sadece JSON döndür.`;
}

// Generate prompt for AI to implement a task
export function getImplementPrompt(spec: Spec, task: Task, codebaseContext: string): string {
  const relatedReqs = spec.requirements.filter(r => task.requirementIds.includes(r.id));
  const relatedDesign = spec.design.filter(d => 
    task.description.toLowerCase().includes(d.component.toLowerCase())
  );
  
  return `Bu görevi uygula:

TASK: ${task.title}
AÇIKLAMA: ${task.description}
DOSYA: ${task.file || "Belirtilmemiş"}

İLGİLİ REQUIREMENTS:
${relatedReqs.map(r => `- ${r.description}\n  Acceptance: ${r.acceptance.join(", ")}`).join("\n")}

İLGİLİ DESIGN:
${relatedDesign.map(d => `- ${d.component}: ${d.description}`).join("\n")}

${codebaseContext}

Kodu yaz ve write_file tool'u ile kaydet.`;
}
