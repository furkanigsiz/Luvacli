import * as fs from "fs";
import * as path from "path";
// Transaction storage
const transactions = new Map();
function resolvePath(filePath) {
    if (path.isAbsolute(filePath))
        return filePath;
    return path.resolve(process.cwd(), filePath);
}
// Create a new transaction
export function createTransaction(edits) {
    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const backups = new Map();
    // Backup existing files
    for (const edit of edits) {
        const resolved = resolvePath(edit.path);
        if (fs.existsSync(resolved)) {
            backups.set(resolved, fs.readFileSync(resolved, "utf-8"));
        }
        else {
            backups.set(resolved, null);
        }
    }
    const transaction = {
        id,
        timestamp: Date.now(),
        edits,
        backups,
        applied: false
    };
    transactions.set(id, transaction);
    return transaction;
}
// Apply transaction atomically
export function applyTransaction(transaction) {
    const results = [];
    const appliedPaths = [];
    try {
        for (const edit of transaction.edits) {
            const resolved = resolvePath(edit.path);
            switch (edit.type) {
                case "create":
                    const dir = path.dirname(resolved);
                    if (!fs.existsSync(dir))
                        fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(resolved, edit.content || "", "utf-8");
                    results.push(`✅ Created: ${edit.path}`);
                    break;
                case "modify":
                    if (!fs.existsSync(resolved)) {
                        throw new Error(`File not found: ${edit.path}`);
                    }
                    if (edit.content !== undefined) {
                        fs.writeFileSync(resolved, edit.content, "utf-8");
                        results.push(`✅ Modified: ${edit.path}`);
                    }
                    else if (edit.oldText && edit.newText !== undefined) {
                        const content = fs.readFileSync(resolved, "utf-8");
                        if (!content.includes(edit.oldText)) {
                            throw new Error(`Text not found in ${edit.path}`);
                        }
                        fs.writeFileSync(resolved, content.replace(edit.oldText, edit.newText), "utf-8");
                        results.push(`✅ Edited: ${edit.path}`);
                    }
                    break;
                case "delete":
                    if (fs.existsSync(resolved)) {
                        fs.unlinkSync(resolved);
                        results.push(`✅ Deleted: ${edit.path}`);
                    }
                    break;
            }
            appliedPaths.push(resolved);
        }
        transaction.applied = true;
        return { success: true, results };
    }
    catch (error) {
        // Rollback on failure
        for (const appliedPath of appliedPaths) {
            const backup = transaction.backups.get(appliedPath);
            if (backup === null) {
                // File didn't exist before, delete it
                if (fs.existsSync(appliedPath))
                    fs.unlinkSync(appliedPath);
            }
            else if (backup !== undefined) {
                // Restore original content
                fs.writeFileSync(appliedPath, backup, "utf-8");
            }
        }
        results.push(`❌ Error: ${error.message}`);
        results.push(`🔄 Rolled back ${appliedPaths.length} files`);
        return { success: false, error: error.message, results };
    }
}
// Rollback a transaction
export function rollbackTransaction(transactionId) {
    const transaction = transactions.get(transactionId);
    if (!transaction) {
        return { success: false, message: `Transaction not found: ${transactionId}` };
    }
    if (!transaction.applied) {
        return { success: false, message: "Transaction was not applied" };
    }
    try {
        for (const [filePath, backup] of transaction.backups) {
            if (backup === null) {
                // File didn't exist before, delete it
                if (fs.existsSync(filePath))
                    fs.unlinkSync(filePath);
            }
            else {
                // Restore original content
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir))
                    fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(filePath, backup, "utf-8");
            }
        }
        transaction.applied = false;
        return { success: true, message: `✅ Rolled back transaction ${transactionId}` };
    }
    catch (error) {
        return { success: false, message: `❌ Rollback failed: ${error.message}` };
    }
}
// List recent transactions
export function listTransactions() {
    if (transactions.size === 0) {
        return "No transactions recorded.";
    }
    let output = "📋 Recent Transactions:\n\n";
    const sorted = Array.from(transactions.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);
    for (const tx of sorted) {
        const date = new Date(tx.timestamp).toLocaleString();
        const status = tx.applied ? "✅ applied" : "⏸️ pending";
        output += `${tx.id}\n`;
        output += `  📅 ${date} | ${status}\n`;
        output += `  📝 ${tx.edits.length} edits: ${tx.edits.map(e => `${e.type} ${path.basename(e.path)}`).join(", ")}\n\n`;
    }
    return output;
}
// Get transaction by ID
export function getTransaction(id) {
    return transactions.get(id);
}
// Preview transaction changes
export function previewTransaction(edits) {
    let preview = "📋 Transaction Preview:\n\n";
    for (const edit of edits) {
        const resolved = resolvePath(edit.path);
        const exists = fs.existsSync(resolved);
        switch (edit.type) {
            case "create":
                preview += `➕ CREATE: ${edit.path}\n`;
                if (edit.content) {
                    const lines = edit.content.split("\n").length;
                    preview += `   ${lines} lines\n`;
                }
                break;
            case "modify":
                preview += `✏️ MODIFY: ${edit.path}`;
                if (!exists)
                    preview += " ⚠️ (file not found)";
                preview += "\n";
                if (edit.oldText && edit.newText !== undefined) {
                    preview += `   Replace: "${edit.oldText.slice(0, 50)}..."\n`;
                    preview += `   With: "${edit.newText.slice(0, 50)}..."\n`;
                }
                break;
            case "delete":
                preview += `🗑️ DELETE: ${edit.path}`;
                if (!exists)
                    preview += " ⚠️ (already deleted)";
                preview += "\n";
                break;
        }
    }
    return preview;
}
// High-level multi-file edit function
export function multiFileEdit(edits) {
    const transaction = createTransaction(edits);
    const preview = previewTransaction(edits);
    const result = applyTransaction(transaction);
    let output = preview + "\n";
    output += result.results.join("\n") + "\n";
    if (result.success) {
        output += `\n🔖 Transaction ID: ${transaction.id}\n`;
        output += `💡 Rollback: rollback_transaction("${transaction.id}")\n`;
    }
    return output;
}
