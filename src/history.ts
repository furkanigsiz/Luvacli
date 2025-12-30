import * as fs from "fs";
import * as path from "path";

export interface FileSnapshot {
  id: string;
  path: string;
  content: string | null; // null = file didn't exist
  timestamp: number;
  operation: "write" | "edit" | "delete" | "create";
  description?: string;
}

// In-memory history (last 50 changes per file)
const fileHistory: Map<string, FileSnapshot[]> = new Map();
const MAX_HISTORY_PER_FILE = 50;

// Global change log (last 100 changes)
const changeLog: FileSnapshot[] = [];
const MAX_CHANGE_LOG = 100;

function generateId(): string {
  return `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Take snapshot before modifying a file
export function takeSnapshot(
  filePath: string, 
  operation: FileSnapshot["operation"],
  description?: string
): FileSnapshot {
  const resolved = path.resolve(filePath);
  
  let content: string | null = null;
  if (fs.existsSync(resolved)) {
    try {
      content = fs.readFileSync(resolved, "utf-8");
    } catch {}
  }
  
  const snapshot: FileSnapshot = {
    id: generateId(),
    path: resolved,
    content,
    timestamp: Date.now(),
    operation,
    description
  };
  
  // Add to file history
  const history = fileHistory.get(resolved) || [];
  history.push(snapshot);
  if (history.length > MAX_HISTORY_PER_FILE) {
    history.shift();
  }
  fileHistory.set(resolved, history);
  
  // Add to global change log
  changeLog.push(snapshot);
  if (changeLog.length > MAX_CHANGE_LOG) {
    changeLog.shift();
  }
  
  return snapshot;
}

// Restore file to a specific snapshot
export function restoreSnapshot(snapshotId: string): { success: boolean; message: string } {
  // Find snapshot in change log
  const snapshot = changeLog.find(s => s.id === snapshotId);
  
  if (!snapshot) {
    return { success: false, message: `❌ Snapshot bulunamadı: ${snapshotId}` };
  }
  
  try {
    if (snapshot.content === null) {
      // File didn't exist, delete it
      if (fs.existsSync(snapshot.path)) {
        fs.unlinkSync(snapshot.path);
      }
      return { success: true, message: `✅ Dosya silindi (önceki duruma döndü): ${snapshot.path}` };
    } else {
      // Restore content
      const dir = path.dirname(snapshot.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(snapshot.path, snapshot.content, "utf-8");
      return { success: true, message: `✅ Dosya geri yüklendi: ${snapshot.path}` };
    }
  } catch (error: any) {
    return { success: false, message: `❌ Restore hatası: ${error.message}` };
  }
}

// Restore file to previous state (undo last change)
export function undoLastChange(filePath?: string): { success: boolean; message: string } {
  if (filePath) {
    // Undo specific file
    const resolved = path.resolve(filePath);
    const history = fileHistory.get(resolved);
    
    if (!history || history.length === 0) {
      return { success: false, message: `❌ ${filePath} için geçmiş bulunamadı` };
    }
    
    // Get the last snapshot (state BEFORE the last change)
    const lastSnapshot = history.pop()!; // Remove from history
    
    try {
      if (lastSnapshot.content === null) {
        // File didn't exist before, delete it
        if (fs.existsSync(lastSnapshot.path)) {
          fs.unlinkSync(lastSnapshot.path);
        }
        return { success: true, message: `✅ Dosya silindi (oluşturulmadan önceki duruma döndü): ${path.basename(lastSnapshot.path)}` };
      } else {
        // Restore previous content
        fs.writeFileSync(lastSnapshot.path, lastSnapshot.content, "utf-8");
        return { success: true, message: `✅ Geri alındı: ${path.basename(lastSnapshot.path)} (${lastSnapshot.operation})` };
      }
    } catch (error: any) {
      // Put snapshot back if restore failed
      history.push(lastSnapshot);
      return { success: false, message: `❌ Restore hatası: ${error.message}` };
    }
  } else {
    // Undo last global change
    if (changeLog.length === 0) {
      return { success: false, message: "❌ Geri alınacak değişiklik yok" };
    }
    
    // Get the last snapshot
    const lastSnapshot = changeLog.pop()!;
    
    // Also remove from file history
    const fileHist = fileHistory.get(lastSnapshot.path);
    if (fileHist) {
      const idx = fileHist.findIndex(s => s.id === lastSnapshot.id);
      if (idx !== -1) fileHist.splice(idx, 1);
    }
    
    try {
      if (lastSnapshot.content === null) {
        // File didn't exist before, delete it
        if (fs.existsSync(lastSnapshot.path)) {
          fs.unlinkSync(lastSnapshot.path);
        }
        return { success: true, message: `✅ Dosya silindi (oluşturulmadan önceki duruma döndü): ${path.basename(lastSnapshot.path)}` };
      } else {
        // Restore previous content
        fs.writeFileSync(lastSnapshot.path, lastSnapshot.content, "utf-8");
        return { success: true, message: `✅ Geri alındı: ${path.basename(lastSnapshot.path)} (${lastSnapshot.operation})` };
      }
    } catch (error: any) {
      // Put snapshot back if restore failed
      changeLog.push(lastSnapshot);
      return { success: false, message: `❌ Restore hatası: ${error.message}` };
    }
  }
}

// Get file history
export function getFileHistory(filePath: string): string {
  const resolved = path.resolve(filePath);
  const history = fileHistory.get(resolved);
  
  if (!history || history.length === 0) {
    return `📜 ${filePath} için geçmiş yok`;
  }
  
  let output = `📜 ${filePath} Geçmişi (${history.length} kayıt):\n\n`;
  
  // Show last 10
  const recent = history.slice(-10).reverse();
  for (const snap of recent) {
    const date = new Date(snap.timestamp).toLocaleString();
    const size = snap.content ? `${snap.content.length} chars` : "deleted";
    output += `${snap.id}\n`;
    output += `  📅 ${date} | ${snap.operation} | ${size}\n`;
    if (snap.description) output += `  📝 ${snap.description}\n`;
    output += "\n";
  }
  
  return output;
}

// Get recent changes (global)
export function getRecentChanges(count: number = 10): string {
  if (changeLog.length === 0) {
    return "📜 Henüz değişiklik yok";
  }
  
  let output = `📜 Son Değişiklikler (${Math.min(count, changeLog.length)}/${changeLog.length}):\n\n`;
  
  const recent = changeLog.slice(-count).reverse();
  for (const snap of recent) {
    const date = new Date(snap.timestamp).toLocaleString();
    const fileName = path.basename(snap.path);
    const size = snap.content ? `${snap.content.length} chars` : "new file";
    output += `${snap.id}\n`;
    output += `  📄 ${fileName} | ${snap.operation} | ${size}\n`;
    output += `  📅 ${date}\n`;
    if (snap.description) output += `  📝 ${snap.description}\n`;
    output += "\n";
  }
  
  output += `💡 Geri almak için: undo veya restore <snapshot_id>\n`;
  
  return output;
}

// Clear history
export function clearHistory(): string {
  const fileCount = fileHistory.size;
  const changeCount = changeLog.length;
  
  fileHistory.clear();
  changeLog.length = 0;
  
  return `🗑️ Geçmiş temizlendi: ${fileCount} dosya, ${changeCount} değişiklik`;
}
