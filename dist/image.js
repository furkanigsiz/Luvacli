import * as fs from "fs";
import * as path from "path";
const SUPPORTED_FORMATS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
// Parse image references from message
export function parseImageReferences(message, cwd) {
    const images = [];
    let cleanMessage = message;
    // @image:path/to/image.png
    const imageRegex = /@image:([^\s]+)/g;
    let match;
    while ((match = imageRegex.exec(message)) !== null) {
        const imagePath = path.resolve(cwd, match[1]);
        const ext = path.extname(imagePath).toLowerCase();
        if (SUPPORTED_FORMATS.includes(ext) && fs.existsSync(imagePath)) {
            try {
                const data = fs.readFileSync(imagePath);
                const base64 = data.toString("base64");
                const mimeType = getMimeType(ext);
                images.push({
                    path: match[1],
                    mimeType,
                    data: base64
                });
            }
            catch { }
        }
        cleanMessage = cleanMessage.replace(match[0], "");
    }
    return { cleanMessage: cleanMessage.trim(), images };
}
// Get MIME type from extension
function getMimeType(ext) {
    const mimeTypes = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp"
    };
    return mimeTypes[ext] || "image/png";
}
// Build Gemini-compatible image parts
export function buildImageParts(images) {
    return images.map(img => ({
        inlineData: {
            mimeType: img.mimeType,
            data: img.data
        }
    }));
}
// Format image info for display
export function formatImageInfo(images) {
    if (images.length === 0)
        return "";
    return `🖼️ ${images.length} görsel: ${images.map(i => path.basename(i.path)).join(", ")}`;
}
// Check if clipboard has image (Windows)
export async function getClipboardImage() {
    // This would require native modules or PowerShell
    // For now, return null - can be implemented later
    return null;
}
