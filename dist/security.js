/**
 * Security Module - Güvenlik kontrolleri
 *
 * 1. Tehlikeli komut kontrolü
 * 2. Path jail (sadece cwd altına yazma)
 * 3. Kritik işlemler için onay
 */
import * as path from "path";
import * as readline from "readline";
// Tehlikeli komut pattern'leri
const DANGEROUS_COMMANDS = [
    /rm\s+(-rf?|--recursive)\s+[\/~]/i, // rm -rf / veya ~
    /rm\s+-rf?\s+\.\./i, // rm -rf ..
    /sudo\s+/i, // sudo komutları
    /chmod\s+777/i, // chmod 777
    /curl\s+.*\|\s*(ba)?sh/i, // curl | sh
    /wget\s+.*\|\s*(ba)?sh/i, // wget | sh
    />\s*\/etc\//i, // > /etc/
    />\s*~\//i, // > ~/
    /mkfs\./i, // mkfs (disk format)
    /dd\s+if=/i, // dd komutları
    /:\(\)\s*\{\s*:\|:\s*&\s*\}/, // fork bomb
    /shutdown/i, // shutdown
    /reboot/i, // reboot
    /format\s+[a-z]:/i, // Windows format
    /del\s+\/[sfq]/i, // Windows del /s /f /q
    /rmdir\s+\/s/i, // Windows rmdir /s
];
// Uyarı gerektiren komutlar (onay istenir)
const WARNING_COMMANDS = [
    /npm\s+publish/i, // npm publish
    /git\s+push\s+.*--force/i, // git push --force
    /git\s+reset\s+--hard/i, // git reset --hard
    /drop\s+database/i, // DROP DATABASE
    /drop\s+table/i, // DROP TABLE
    /truncate\s+table/i, // TRUNCATE TABLE
    /rm\s+-rf?\s+node_modules/i, // rm -rf node_modules (uyarı)
    /npm\s+uninstall/i, // npm uninstall
];
// Yasak path pattern'leri
const FORBIDDEN_PATHS = [
    /^\/etc\//,
    /^\/usr\//,
    /^\/bin\//,
    /^\/sbin\//,
    /^\/var\//,
    /^\/root\//,
    /^\/home\/[^/]+\/\.(bashrc|zshrc|profile|ssh)/,
    /^~\/\.(bashrc|zshrc|profile|ssh)/,
    /^[A-Z]:\\Windows/i,
    /^[A-Z]:\\Program Files/i,
    /^[A-Z]:\\Users\\[^\\]+\\AppData/i,
];
/**
 * Komut güvenlik kontrolü
 */
export function checkCommand(command) {
    // Tehlikeli komut kontrolü
    for (const pattern of DANGEROUS_COMMANDS) {
        if (pattern.test(command)) {
            return {
                allowed: false,
                reason: `Tehlikeli komut engellendi: ${command.slice(0, 50)}...`
            };
        }
    }
    // Uyarı gerektiren komutlar
    for (const pattern of WARNING_COMMANDS) {
        if (pattern.test(command)) {
            return {
                allowed: true,
                requiresConfirmation: true,
                warning: `Bu komut dikkat gerektirir: ${command.slice(0, 50)}...`
            };
        }
    }
    return { allowed: true };
}
/**
 * Path güvenlik kontrolü - sadece cwd altına izin ver
 */
export function checkPath(targetPath, cwd = process.cwd()) {
    // Absolute path'e çevir
    const absolutePath = path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(cwd, targetPath);
    // Normalize et (.. ve . çöz)
    const normalizedPath = path.normalize(absolutePath);
    const normalizedCwd = path.normalize(cwd);
    // cwd dışına çıkıyor mu?
    if (!normalizedPath.startsWith(normalizedCwd)) {
        return {
            allowed: false,
            reason: `Path cwd dışında: ${targetPath} (cwd: ${cwd})`
        };
    }
    // Yasak path kontrolü
    for (const pattern of FORBIDDEN_PATHS) {
        if (pattern.test(normalizedPath)) {
            return {
                allowed: false,
                reason: `Yasak path: ${targetPath}`
            };
        }
    }
    // .. ile üst dizine çıkma girişimi
    if (targetPath.includes("..")) {
        const resolved = path.resolve(cwd, targetPath);
        if (!resolved.startsWith(normalizedCwd)) {
            return {
                allowed: false,
                reason: `Path traversal engellendi: ${targetPath}`
            };
        }
    }
    return { allowed: true };
}
/**
 * Kullanıcıdan onay al (sync)
 */
export async function confirmAction(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(`\n⚠️  ${message} [y/N]: `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}
/**
 * Dosya yazma güvenlik kontrolü
 */
export function checkFileWrite(filePath, cwd = process.cwd()) {
    const pathCheck = checkPath(filePath, cwd);
    if (!pathCheck.allowed) {
        return pathCheck;
    }
    // Kritik dosya kontrolü
    const filename = path.basename(filePath).toLowerCase();
    const criticalFiles = ['.env', '.gitignore', 'package.json', 'tsconfig.json'];
    if (criticalFiles.includes(filename)) {
        return {
            allowed: true,
            requiresConfirmation: false, // Agent mode'da onay istemiyoruz
            warning: `Kritik dosya değiştiriliyor: ${filename}`
        };
    }
    return { allowed: true };
}
/**
 * Dosya silme güvenlik kontrolü
 */
export function checkFileDelete(filePath, cwd = process.cwd()) {
    const pathCheck = checkPath(filePath, cwd);
    if (!pathCheck.allowed) {
        return pathCheck;
    }
    return {
        allowed: true,
        requiresConfirmation: false
    };
}
// Global security mode
let securityMode = "normal";
export function setSecurityMode(mode) {
    securityMode = mode;
}
export function getSecurityMode() {
    return securityMode;
}
/**
 * Güvenlik özeti
 */
export function getSecurityInfo() {
    return `
🔒 Security Mode: ${securityMode}

Engellenen:
  • rm -rf /, sudo, curl|sh gibi tehlikeli komutlar
  • cwd dışına dosya yazma
  • /etc, /usr, ~/.ssh gibi sistem dizinleri

Uyarı verilenler:
  • npm publish, git push --force
  • DROP DATABASE, TRUNCATE TABLE
`;
}
