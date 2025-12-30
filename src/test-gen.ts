import * as fs from "fs";
import * as path from "path";

export interface TestConfig {
  framework: "vitest" | "jest" | "node";
  pattern: string;
  setupFile?: string;
}

// Detect test framework from package.json
export function detectTestFramework(cwd: string): TestConfig {
  const pkgPath = path.join(cwd, "package.json");
  
  if (!fs.existsSync(pkgPath)) {
    return { framework: "node", pattern: "**/*.test.ts" };
  }
  
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (deps.vitest) {
      return { framework: "vitest", pattern: "**/*.test.ts" };
    }
    if (deps.jest) {
      return { framework: "jest", pattern: "**/*.test.ts" };
    }
  } catch {}
  
  return { framework: "node", pattern: "**/*.test.ts" };
}

// Generate test file content
export function generateTestContent(
  sourceFile: string,
  sourceContent: string,
  framework: "vitest" | "jest" | "node"
): string {
  const fileName = path.basename(sourceFile, path.extname(sourceFile));
  const relativePath = `./${fileName}`;
  
  // Extract exports from source
  const exports = extractExports(sourceContent);
  
  // Generate imports
  let imports = "";
  let testRunner = "";
  
  switch (framework) {
    case "vitest":
      imports = `import { describe, it, expect, beforeEach, afterEach } from "vitest";\n`;
      testRunner = "vitest";
      break;
    case "jest":
      imports = ""; // Jest globals
      testRunner = "jest";
      break;
    case "node":
      imports = `import { describe, it, beforeEach, afterEach } from "node:test";\nimport assert from "node:assert";\n`;
      testRunner = "node:test";
      break;
  }
  
  // Import source
  if (exports.length > 0) {
    imports += `import { ${exports.join(", ")} } from "${relativePath}";\n`;
  }
  
  // Generate test cases
  let tests = "";
  
  for (const exp of exports) {
    const info = analyzeExport(exp, sourceContent);
    tests += generateTestCase(exp, info, framework);
  }
  
  // If no exports found, generate placeholder
  if (exports.length === 0) {
    tests = generatePlaceholderTest(fileName, framework);
  }
  
  return `${imports}
${tests}`;
}

// Extract exported names from source
function extractExports(content: string): string[] {
  const exports: string[] = [];
  
  // export function name
  const funcMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
  for (const m of funcMatches) exports.push(m[1]);
  
  // export const name
  const constMatches = content.matchAll(/export\s+const\s+(\w+)/g);
  for (const m of constMatches) exports.push(m[1]);
  
  // export class name
  const classMatches = content.matchAll(/export\s+class\s+(\w+)/g);
  for (const m of classMatches) exports.push(m[1]);
  
  // export { name }
  const namedMatches = content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g);
  for (const m of namedMatches) {
    const names = m[1].split(",").map(n => n.trim().split(" ")[0]);
    exports.push(...names);
  }
  
  return [...new Set(exports)];
}

interface ExportInfo {
  type: "function" | "class" | "const" | "unknown";
  isAsync: boolean;
  params: string[];
  returnType?: string;
}

// Analyze export to understand its signature
function analyzeExport(name: string, content: string): ExportInfo {
  // Check if async function
  const asyncFuncMatch = content.match(new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(([^)]*)\\)`));
  if (asyncFuncMatch) {
    return {
      type: "function",
      isAsync: true,
      params: parseParams(asyncFuncMatch[1])
    };
  }
  
  // Check if function
  const funcMatch = content.match(new RegExp(`export\\s+function\\s+${name}\\s*\\(([^)]*)\\)`));
  if (funcMatch) {
    return {
      type: "function",
      isAsync: false,
      params: parseParams(funcMatch[1])
    };
  }
  
  // Check if class
  const classMatch = content.match(new RegExp(`export\\s+class\\s+${name}`));
  if (classMatch) {
    return { type: "class", isAsync: false, params: [] };
  }
  
  // Check if const (arrow function)
  const arrowMatch = content.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(async\\s*)?\\(([^)]*)\\)\\s*=>`));
  if (arrowMatch) {
    return {
      type: "function",
      isAsync: !!arrowMatch[1],
      params: parseParams(arrowMatch[2])
    };
  }
  
  return { type: "unknown", isAsync: false, params: [] };
}

// Parse function parameters
function parseParams(paramStr: string): string[] {
  if (!paramStr.trim()) return [];
  return paramStr.split(",").map(p => p.trim().split(":")[0].trim());
}

// Generate test case for an export
function generateTestCase(name: string, info: ExportInfo, framework: string): string {
  const expectFn = framework === "node" ? "assert.strictEqual" : "expect";
  const asyncPrefix = info.isAsync ? "async " : "";
  
  if (info.type === "class") {
    return `
describe("${name}", () => {
  let instance: ${name};

  beforeEach(() => {
    instance = new ${name}();
  });

  it("should create instance", () => {
    ${framework === "node" ? `assert.ok(instance);` : `expect(instance).toBeDefined();`}
  });

  // TODO: Add more tests
});
`;
  }
  
  if (info.type === "function") {
    const paramPlaceholders = info.params.map((p, i) => {
      // Generate sensible defaults based on param name
      if (p.includes("name") || p.includes("str")) return `"test"`;
      if (p.includes("num") || p.includes("count") || p.includes("id")) return `1`;
      if (p.includes("arr") || p.includes("list")) return `[]`;
      if (p.includes("obj") || p.includes("data")) return `{}`;
      if (p.includes("flag") || p.includes("is") || p.includes("has")) return `true`;
      return `undefined /* ${p} */`;
    }).join(", ");
    
    return `
describe("${name}", () => {
  it("should work with valid input", ${asyncPrefix}() => {
    const result = ${info.isAsync ? "await " : ""}${name}(${paramPlaceholders});
    ${framework === "node" 
      ? `assert.ok(result !== undefined);` 
      : `expect(result).toBeDefined();`}
  });

  it("should handle edge cases", ${asyncPrefix}() => {
    // TODO: Add edge case tests
  });
});
`;
  }
  
  return `
describe("${name}", () => {
  it("should be defined", () => {
    ${framework === "node" 
      ? `assert.ok(${name} !== undefined);` 
      : `expect(${name}).toBeDefined();`}
  });
});
`;
}

// Generate placeholder test
function generatePlaceholderTest(fileName: string, framework: string): string {
  return `
describe("${fileName}", () => {
  it("should pass placeholder test", () => {
    ${framework === "node" 
      ? `assert.ok(true);` 
      : `expect(true).toBe(true);`}
  });

  // TODO: Add actual tests
});
`;
}

// Get test file path for a source file
export function getTestFilePath(sourceFile: string): string {
  const dir = path.dirname(sourceFile);
  const ext = path.extname(sourceFile);
  const base = path.basename(sourceFile, ext);
  
  // Check if __tests__ folder exists
  const testsDir = path.join(dir, "__tests__");
  if (fs.existsSync(testsDir)) {
    return path.join(testsDir, `${base}.test${ext}`);
  }
  
  // Same directory
  return path.join(dir, `${base}.test${ext}`);
}

// Generate test for a file
export function generateTestForFile(sourceFile: string, cwd: string): { testPath: string; content: string } {
  const fullPath = path.isAbsolute(sourceFile) ? sourceFile : path.join(cwd, sourceFile);
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${sourceFile}`);
  }
  
  const content = fs.readFileSync(fullPath, "utf-8");
  const config = detectTestFramework(cwd);
  const testContent = generateTestContent(sourceFile, content, config.framework);
  const testPath = getTestFilePath(sourceFile);
  
  return { testPath, content: testContent };
}

// Install test framework if not present
export function getInstallCommand(framework: "vitest" | "jest" | "node"): string | null {
  switch (framework) {
    case "vitest":
      return "npm install -D vitest@latest";
    case "jest":
      return "npm install -D jest@latest @types/jest@latest ts-jest@latest";
    case "node":
      return null; // Built-in
  }
}

// Get run command
export function getRunCommand(framework: "vitest" | "jest" | "node", testFile?: string): string {
  const file = testFile ? ` ${testFile}` : "";
  switch (framework) {
    case "vitest":
      return `npx vitest run${file}`;
    case "jest":
      return `npx jest${file}`;
    case "node":
      return `node --test${file}`;
  }
}

// Format test generation result
export function formatTestGenResult(testPath: string, framework: string): string {
  return `✅ Test dosyası oluşturuldu: ${testPath}

Framework: ${framework}
Çalıştırmak için: ${getRunCommand(framework as any, testPath)}`;
}
