import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface ProjectTemplate {
  name: string;
  description: string;
  category: "frontend" | "backend" | "fullstack" | "cli" | "library";
  generate: (projectName: string, targetDir: string) => Promise<void>;
}

// Helper: Run command
function run(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

// Helper: Write file
function write(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
}

// Templates
export const templates: ProjectTemplate[] = [
  // ============ FRONTEND ============
  {
    name: "react-vite",
    description: "React + Vite + TypeScript + Tailwind",
    category: "frontend",
    async generate(name, dir) {
      run(`npm create vite@latest ${name} -- --template react-ts`, path.dirname(dir));
      run("npm install", dir);
      run("npm install -D tailwindcss@latest postcss@latest autoprefixer@latest", dir);
      run("npx tailwindcss init -p", dir);
      
      // Update tailwind.config.js
      write(path.join(dir, "tailwind.config.js"), `/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}`);
      
      // Update index.css
      write(path.join(dir, "src/index.css"), `@tailwind base;
@tailwind components;
@tailwind utilities;
`);
      
      console.log("✅ React + Vite + Tailwind hazır!");
    }
  },
  {
    name: "next",
    description: "Next.js 15 + TypeScript + Tailwind + App Router",
    category: "fullstack",
    async generate(name, dir) {
      run(`npx create-next-app@latest ${name} --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`, path.dirname(dir));
      console.log("✅ Next.js 15 hazır!");
    }
  },
  {
    name: "vue-vite",
    description: "Vue 3 + Vite + TypeScript + Pinia",
    category: "frontend",
    async generate(name, dir) {
      run(`npm create vite@latest ${name} -- --template vue-ts`, path.dirname(dir));
      run("npm install", dir);
      run("npm install pinia@latest vue-router@latest", dir);
      console.log("✅ Vue 3 + Vite hazır!");
    }
  },
  {
    name: "svelte",
    description: "SvelteKit + TypeScript + Tailwind",
    category: "fullstack",
    async generate(name, dir) {
      run(`npx sv create ${name} --template minimal --types ts`, path.dirname(dir));
      run("npm install", dir);
      run("npx sv add tailwindcss", dir);
      console.log("✅ SvelteKit hazır!");
    }
  },

  // ============ BACKEND ============
  {
    name: "express",
    description: "Express.js + TypeScript + ESLint",
    category: "backend",
    async generate(name, dir) {
      fs.mkdirSync(dir, { recursive: true });
      
      write(path.join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        scripts: {
          dev: "tsx watch src/index.ts",
          build: "tsc",
          start: "node dist/index.js"
        }
      }, null, 2));
      
      run("npm install express@latest cors@latest helmet@latest", dir);
      run("npm install -D typescript@latest @types/node@latest @types/express@latest @types/cors@latest tsx@latest", dir);
      run("npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir dist --strict", dir);
      
      write(path.join(dir, "src/index.ts"), `import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Hello from ${name}!" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`🚀 Server running on http://localhost:\${PORT}\`);
});
`);
      
      write(path.join(dir, ".gitignore"), `node_modules
dist
.env
`);
      
      console.log("✅ Express + TypeScript hazır!");
    }
  },
  {
    name: "fastify",
    description: "Fastify + TypeScript (high performance)",
    category: "backend",
    async generate(name, dir) {
      fs.mkdirSync(dir, { recursive: true });
      
      write(path.join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        scripts: {
          dev: "tsx watch src/index.ts",
          build: "tsc",
          start: "node dist/index.js"
        }
      }, null, 2));
      
      run("npm install fastify@latest @fastify/cors@latest @fastify/helmet@latest", dir);
      run("npm install -D typescript@latest @types/node@latest tsx@latest", dir);
      run("npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir dist --strict", dir);
      
      write(path.join(dir, "src/index.ts"), `import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";

const fastify = Fastify({ logger: true });

await fastify.register(cors);
await fastify.register(helmet);

fastify.get("/", async () => {
  return { message: "Hello from ${name}!" };
});

fastify.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

try {
  await fastify.listen({ port: 3000, host: "0.0.0.0" });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
`);
      
      write(path.join(dir, ".gitignore"), `node_modules
dist
.env
`);
      
      console.log("✅ Fastify + TypeScript hazır!");
    }
  },
  {
    name: "hono",
    description: "Hono + TypeScript (edge-ready, ultra fast)",
    category: "backend",
    async generate(name, dir) {
      run(`npm create hono@latest ${name}`, path.dirname(dir));
      console.log("✅ Hono hazır!");
    }
  },
  {
    name: "elysia",
    description: "Elysia + Bun (fastest TypeScript framework)",
    category: "backend",
    async generate(name, dir) {
      fs.mkdirSync(dir, { recursive: true });
      
      write(path.join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        scripts: {
          dev: "bun run --watch src/index.ts",
          start: "bun run src/index.ts"
        }
      }, null, 2));
      
      run("bun add elysia@latest", dir);
      
      write(path.join(dir, "src/index.ts"), `import { Elysia } from "elysia";

const app = new Elysia()
  .get("/", () => ({ message: "Hello from ${name}!" }))
  .get("/health", () => ({ status: "ok", timestamp: new Date().toISOString() }))
  .listen(3000);

console.log(\`🦊 Elysia running at http://localhost:\${app.server?.port}\`);
`);
      
      write(path.join(dir, ".gitignore"), `node_modules
.env
`);
      
      console.log("✅ Elysia + Bun hazır!");
    }
  },

  // ============ CLI ============
  {
    name: "cli",
    description: "CLI Tool + TypeScript + Commander",
    category: "cli",
    async generate(name, dir) {
      fs.mkdirSync(dir, { recursive: true });
      
      write(path.join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        bin: { [name]: "./dist/index.js" },
        scripts: {
          dev: "tsx src/index.ts",
          build: "tsc",
          start: "node dist/index.js"
        }
      }, null, 2));
      
      run("npm install commander@latest chalk@latest ora@latest", dir);
      run("npm install -D typescript@latest @types/node@latest tsx@latest", dir);
      run("npx tsc --init --target ES2022 --module NodeNext --moduleResolution NodeNext --outDir dist --strict", dir);
      
      write(path.join(dir, "src/index.ts"), `#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

const program = new Command();

program
  .name("${name}")
  .description("CLI tool")
  .version("1.0.0");

program
  .command("hello")
  .description("Say hello")
  .argument("[name]", "Name to greet", "World")
  .action((name) => {
    console.log(chalk.green(\`Hello, \${name}!\`));
  });

program
  .command("spin")
  .description("Show spinner demo")
  .action(async () => {
    const spinner = ora("Loading...").start();
    await new Promise(r => setTimeout(r, 2000));
    spinner.succeed("Done!");
  });

program.parse();
`);
      
      write(path.join(dir, ".gitignore"), `node_modules
dist
`);
      
      console.log("✅ CLI Tool hazır!");
    }
  },

  // ============ LIBRARY ============
  {
    name: "lib",
    description: "TypeScript Library + tsup + Vitest",
    category: "library",
    async generate(name, dir) {
      fs.mkdirSync(dir, { recursive: true });
      
      write(path.join(dir, "package.json"), JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        main: "./dist/index.js",
        module: "./dist/index.mjs",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            import: "./dist/index.mjs",
            require: "./dist/index.js",
            types: "./dist/index.d.ts"
          }
        },
        scripts: {
          dev: "tsup --watch",
          build: "tsup",
          test: "vitest run",
          "test:watch": "vitest"
        }
      }, null, 2));
      
      run("npm install -D typescript@latest tsup@latest vitest@latest @types/node@latest", dir);
      
      write(path.join(dir, "tsup.config.ts"), `import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
`);
      
      write(path.join(dir, "src/index.ts"), `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`);
      
      write(path.join(dir, "src/index.test.ts"), `import { describe, it, expect } from "vitest";
import { greet, add } from "./index";

describe("greet", () => {
  it("should greet by name", () => {
    expect(greet("World")).toBe("Hello, World!");
  });
});

describe("add", () => {
  it("should add two numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
`);
      
      write(path.join(dir, ".gitignore"), `node_modules
dist
`);
      
      console.log("✅ TypeScript Library hazır!");
    }
  },

  // ============ FULLSTACK ============
  {
    name: "t3",
    description: "T3 Stack (Next.js + tRPC + Prisma + Tailwind)",
    category: "fullstack",
    async generate(name, dir) {
      run(`npx create-t3-app@latest ${name} --noGit`, path.dirname(dir));
      console.log("✅ T3 Stack hazır!");
    }
  }
];

// List all templates
export function listTemplates(): string {
  let output = "📦 Proje Şablonları:\n\n";
  
  const categories = ["frontend", "backend", "fullstack", "cli", "library"] as const;
  
  for (const cat of categories) {
    const catTemplates = templates.filter(t => t.category === cat);
    if (catTemplates.length === 0) continue;
    
    const emoji = { frontend: "🎨", backend: "⚙️", fullstack: "🚀", cli: "💻", library: "📚" }[cat];
    output += `${emoji} ${cat.toUpperCase()}\n`;
    
    for (const t of catTemplates) {
      output += `   ${t.name.padEnd(12)} - ${t.description}\n`;
    }
    output += "\n";
  }
  
  output += "Kullanım: /new <template> <project-name>";
  return output;
}

// Create project from template
export async function createProject(templateName: string, projectName: string): Promise<string> {
  const template = templates.find(t => t.name === templateName);
  if (!template) {
    return `❌ Template bulunamadı: ${templateName}\n\nMevcut templates için: /new list`;
  }
  
  const targetDir = path.join(process.cwd(), projectName);
  
  if (fs.existsSync(targetDir)) {
    return `❌ Klasör zaten var: ${projectName}`;
  }
  
  console.log(`\n🚀 ${template.name} projesi oluşturuluyor: ${projectName}\n`);
  
  try {
    await template.generate(projectName, targetDir);
    return `\n✅ Proje hazır: ${projectName}\n\nBaşlamak için:\n  cd ${projectName}\n  npm run dev`;
  } catch (err: any) {
    return `❌ Hata: ${err.message}`;
  }
}
