# Luva Agentic Roadmap

Cursor/Kiro seviyesinde full agentic AI için gerekli özellikler ve mevcut durum.

---

## ✅ Tamamlanan Özellikler

| Özellik | Durum | Açıklama |
|---------|-------|----------|
| Dosya okuma/yazma | ✅ | `read_file`, `write_file`, `append_file` |
| Diff-based editing | ✅ | `edit_file` - sadece değişen kısmı düzenler |
| Klasör işlemleri | ✅ | `list_directory`, `create_directory`, `delete_file` |
| Komut çalıştırma | ✅ | `run_command` - PowerShell/Bash |
| Git entegrasyonu | ✅ | `git_status`, `git_diff`, `git_commit` |
| Web search | ✅ | `web_search` - DuckDuckGo API |
| Dosya arama | ✅ | `search_files` - regex ile arama |
| Proje yapısı | ✅ | `get_file_structure` - ağaç görünümü |
| PAI context | ✅ | SKILL.md, CoreStack.md yükleniyor |
| Konuşma geçmişi | ✅ | Sessions klasörüne kaydediliyor |
| Streaming output | ✅ | Anlık karakter karakter gösterim |
| Skill routing | ✅ | Mesaja göre skill seçimi |
| Workflow desteği | ✅ | Skill içi workflow tetikleme |

---

## ❌ PAI'de Olup Luva'da Eksik Olanlar

### 1. Hook System (Event-Driven Automation)
**PAI Pack:** `kai-hook-system`

Claude Code'da otomatik tetiklenen hook'lar:
- `PreToolUse` - Tool çağrılmadan önce
- `PostToolUse` - Tool çağrıldıktan sonra  
- `SessionStart` - Oturum başlangıcı
- `SessionEnd` - Oturum bitişi

**Luva'da:** Yok - Gemini API hook desteği sunmuyor. Simüle edilebilir.

---

### 2. History System (Granular Context Tracking)
**PAI Pack:** `kai-history-system`

Otomatik kayıt:
- Session summaries
- Learnings (öğrenilen şeyler)
- Decisions (alınan kararlar)
- Research (araştırma notları)

**Luva'da:** Kısmi - Sadece session history var. Learnings/Decisions yok.

---

### 3. Voice System (TTS Notifications)
**PAI Pack:** `kai-voice-system`

ElevenLabs ile sesli bildirimler:
- Session başlangıç/bitiş
- Önemli olaylar
- Prosody enhancement

**Luva'da:** Yok - Eklenebilir.

---

### 4. Observability Server (Real-time Dashboard)
**PAI Pack:** `kai-observability-server`

Web dashboard:
- Agent aktivitesi izleme
- Tool kullanım istatistikleri
- WebSocket streaming

**Luva'da:** Yok - Ayrı bir proje olarak eklenebilir.

---

### 5. Multi-Agent Orchestration
**PAI'de:** Birden fazla agent koordinasyonu

**Luva'da:** Yok - Tek agent.

---

## 🎯 Öncelik Sırası

| Özellik | Zorluk | Değer | Öncelik |
|---------|--------|-------|---------|
| History System (full) | Orta | Yüksek | 1 |
| Voice System | Kolay | Orta | 2 |
| Hook Simulation | Orta | Orta | 3 |
| Observability | Yüksek | Düşük | 4 |

---

## 📊 Cursor vs Luva vs PAI Karşılaştırması

| Özellik | Cursor | Luva | PAI (Claude Code) |
|---------|--------|------|-------------------|
| Dosya düzenleme | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ |
| Git entegrasyonu | ✅ | ✅ | ✅ |
| Web search | ✅ | ✅ | ✅ |
| Skill routing | ❌ | ✅ | ✅ |
| **Embedding Search** | ✅ | ✅ | ✅ |
| **AST Chunking** | ✅ | ✅ | ✅ |
| **Dependency Graph** | ✅ | ✅ | ✅ |
| **Token Budget** | ✅ | ✅ | ✅ |
| **getDiagnostics** | ✅ | ✅ | ✅ |
| **Steering Files** | ✅ | ✅ | ✅ |
| **Background Process** | ✅ | ✅ | ✅ |
| **Agent Mode** | ✅ | ✅ | ✅ |
| **Spec System** | ❌ | ✅ | ❌ |
| **File References** | ✅ | ✅ | ❌ |
| Hook system | ❌ | ❌ | ✅ |
| Voice notifications | ❌ | ❌ | ✅ |
| Observability | ❌ | ❌ | ✅ |
| Multi-agent | ❌ | ❌ | ✅ |
| Özelleştirme | ❌ | ✅ | ✅ |
| Açık kaynak | ❌ | ✅ | ✅ |
| Ücretsiz | ❌ | ✅ | ✅ |

---

Codebase Indexing	✅ Tüm projeyi anlıyor	✅	Yüksek
LSP/Diagnostics	✅ Syntax/type hataları	✅	Yüksek
Multi-file Atomic Edit	✅ Rollback destekli	✅	Orta
Context Management	✅ Akıllı dosya seçimi	✅	Orta
Inline Diff Preview	✅ Değişiklikleri göster	❌ (CLI)	-
IDE Entegrasyonu	✅ Native	❌	Yüksek
Image Understanding	✅ Screenshot analizi	✅	Kolay
@ Mentions	✅ @file, @folder, @web	✅	Orta
Composer (Multi-step)	✅ Otomatik planlama	✅	Orta

*Son güncelleme: 2024-12-30*

## ✅ Yeni Eklenen Özellikler (v1.1)

| Özellik | Açıklama |
|---------|----------|
| Codebase Indexing | Otomatik proje tarama, sembol çıkarma |
| LSP/Diagnostics | TypeScript/ESLint hata kontrolü |
| Context Management | Akıllı dosya seçimi, token budget |
| Multi-file Edit | Atomik düzenleme, rollback destekli |
| Undo/Restore | Cursor/Kiro tarzı geri alma |
| Global Config | ~/.config/luva/.env desteği |
| Auto Context | Her mesajda otomatik ilgili dosya seçimi |
| @ Mentions | @file:path @folder:path @web:query @git @symbol:name |
| Image Understanding | @image:path ile görsel analizi (Gemini Vision) |
| Spec System | Kiro-style requirements → design → tasks workflow |

## ✅ Yeni Eklenen Özellikler (v1.2)

| Özellik | Açıklama |
|---------|----------|
| Steering Files | Kiro-style .luva/steering/*.md proje kuralları |
| Background Process | Dev server, watcher yönetimi (start/stop/list) |
| Process Output | Çalışan process'lerin çıktısını okuma |
| Steering Modes | always, fileMatch, manual dahil etme modları |

### Steering Kullanımı

```bash
# Steering dosyalarını listele
steering

# Yeni steering oluştur (tool ile)
# create_steering ile .luva/steering/rules.md oluşturulur

# Steering dosyası örneği (.luva/steering/typescript.md):
---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
description: "TypeScript kuralları"
---

# TypeScript Kuralları
- Strict mode kullan
- any kullanma
```

### Background Process Kullanımı

```bash
# Process'leri listele
processes
ps

# Tool'lar ile:
# start_process: npm run dev
# stop_process: 1
# get_process_output: 1
```

## ✅ Yeni Eklenen Özellikler (v1.4) - Agent Mode & Enhanced Spec

| Özellik | Açıklama |
|---------|----------|
| Agent Mode | Cursor-style tam otomatik görev çalıştırma |
| /agent <goal> | Hedef ver, AI planla ve uygula |
| /spec auto | Tüm spec task'larını otomatik uygula |
| File References | Kiro-style #[[file:path]] referansları |
| Auto-fix Loop | Hata varsa otomatik düzeltme |
| Step-by-step Execution | Her adımı sırayla uygula, hata kontrolü |

### Agent Mode Kullanımı

```bash
# Basit görev
/agent add user authentication

# Karmaşık özellik
/agent implement REST API with CRUD for products

# Spec'ten agent mode
/spec new E-commerce
/spec req
/spec design  
/spec tasks
/spec auto    # Tüm task'ları otomatik uygula
```

### Kiro-style File References

```bash
# Spec oluştururken dış dosya referansı
/spec new Payment API
> Stripe entegrasyonu yap. API spec: #[[file:docs/openapi.yaml]]

# Referans edilen dosyalar otomatik context'e eklenir
```

## ✅ Yeni Eklenen Özellikler (v1.3) - Smart Context

| Özellik | Açıklama |
|---------|----------|
| Embedding Search | Gemini text-embedding-004 ile semantic search (ÜCRETSİZ!) |
| AST Chunking | Dosyaları fonksiyon/class/interface bazında parçalama |
| Dependency Graph | Import chain tracking, ilgili dosyaları bulma |
| Token Budget | Öncelikli context seçimi, otomatik truncation |
| Context Optimizer | History optimizasyonu, deduplication |
| Usage Tracking | Token kullanımı ve maliyet takibi |
| getDiagnostics | TypeScript/ESLint/CSS hata kontrolü |

### Smart Context Kullanımı

```bash
# Smart index oluştur (embedding + dependency graph)
smart index
si

# Smart context durumunu göster
smart status
ss

# Context istatistikleri
ctx

# Token kullanımı
usage
stats
```

### Nasıl Çalışır?

1. **Embedding Index**: `si` komutu ile tüm codebase embedding'e dönüştürülür
2. **Semantic Search**: Her mesajda query embedding ile en alakalı chunk'lar bulunur
3. **Dependency Graph**: Aktif dosyaların import'ları ve dependentları eklenir
4. **Token Budget**: Öncelik sırasına göre context seçilir:
   - Mentioned files (100 priority)
   - Active files (90 priority)
   - Semantic matches (70-90 priority)
   - Dependencies (50 priority)

### Maliyet Optimizasyonu

- Embedding API: **ÜCRETSİZ** (Gemini text-embedding-004)
- History optimization: Eski mesajlar otomatik kısaltılır
- Smart truncation: Büyük dosyalar akıllıca kesilir
- Deduplication: Tekrar eden içerik kaldırılır

### Pricing (Gemini 2.5 Pro)

| Tip | Fiyat |
|-----|-------|
| Input | $0.50 / 1M token |
| Output | $3.00 / 1M token |
| Embedding | ÜCRETSİZ |

Her cevap sonrası token kullanımı gösterilir:
```
📊 1,234 token (↑890 ↓344) ~$0.0015
```
