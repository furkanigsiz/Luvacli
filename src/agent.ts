/**
 * Agent Mode - Cursor-style autonomous execution
 * 
 * /agent <goal> komutu ile tam otomatik:
 * 1. Plan oluştur
 * 2. Her adımı uygula
 * 3. Hata varsa düzelt
 * 4. Test et
 */

import * as fs from "fs";
import * as path from "path";
import { Content } from "@google/generative-ai";
import { executeTool, executeToolsParallel } from "./tools.js";
import { getDiagnostics, formatDiagnostics } from "./diagnostics.js";
import { getAgentPlanPrompt, getAgentStepPrompt, getFixErrorsPrompt } from "./prompts.js";
import { sendMessageWithRetry } from "./retry.js";

export interface AgentStep {
  id: number;
  description: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: string;
  error?: string;
  retries: number;
}

export interface AgentPlan {
  goal: string;
  steps: AgentStep[];
  status: "planning" | "executing" | "fixing" | "done" | "failed";
  startedAt: string;
  completedAt?: string;
  totalRetries: number;
  maxRetries: number;
}

export interface AgentConfig {
  maxRetries: number;        // Her step için max retry
  maxTotalRetries: number;   // Toplam max retry
  autoFix: boolean;          // Hata varsa otomatik düzelt
  confirmSteps: boolean;     // Her adımda onay iste (false = tam otonom)
  verbose: boolean;          // Detaylı log
}

const DEFAULT_CONFIG: AgentConfig = {
  maxRetries: 3,
  maxTotalRetries: 10,
  autoFix: true,
  confirmSteps: false,
  verbose: true
};

// ANSI colors
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
};

/**
 * Agent Mode - Ana fonksiyon
 */
export async function runAgentMode(
  model: any,
  goal: string,
  codebaseContext: string,
  config: Partial<AgentConfig> = {}
): Promise<AgentPlan> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  console.log(`\n${c.magenta}${c.bold}🤖 AGENT MODE${c.reset}`);
  console.log(`${c.dim}Goal: ${goal}${c.reset}\n`);

  const plan: AgentPlan = {
    goal,
    steps: [],
    status: "planning",
    startedAt: new Date().toISOString(),
    totalRetries: 0,
    maxRetries: cfg.maxTotalRetries
  };

  try {
    // 1. Plan oluştur
    console.log(`${c.cyan}📋 Plan oluşturuluyor...${c.reset}`);
    plan.steps = await createPlan(model, goal, codebaseContext);
    console.log(`${c.green}✓ ${plan.steps.length} adımlık plan hazır${c.reset}\n`);
    
    printPlan(plan);

    // 2. Her adımı uygula
    plan.status = "executing";
    
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const isLastStep = i === plan.steps.length - 1;
      
      // Skip if already done
      if (step.status === "done" || step.status === "skipped") continue;
      
      console.log(`\n${c.blue}━━━ Step ${step.id}/${plan.steps.length} ━━━${c.reset}`);
      console.log(`${c.bold}${step.description}${c.reset}\n`);
      
      step.status = "running";
      
      try {
        // Execute step
        const result = await executeStep(model, step, plan, codebaseContext);
        step.result = result;
        step.status = "done";
        console.log(`${c.green}✓ Step ${step.id} tamamlandı${c.reset}`);
        
        // Auto-diagnostics: SADECE son step'te çalıştır
        // Ara step'lerde dependency eksik olabilir, gereksiz hata verir
        if (cfg.autoFix && isLastStep) {
          const errors = await checkAndFix(model, codebaseContext, false);
          if (errors) {
            plan.totalRetries++;
            console.log(`${c.yellow}🔧 Hatalar düzeltildi${c.reset}`);
          }
        }
        
      } catch (error: any) {
        step.error = error.message;
        step.retries++;
        plan.totalRetries++;
        
        console.log(`${c.red}✗ Step ${step.id} hata: ${error.message}${c.reset}`);
        
        // Retry logic
        if (step.retries < cfg.maxRetries && plan.totalRetries < cfg.maxTotalRetries) {
          console.log(`${c.yellow}↻ Retry ${step.retries}/${cfg.maxRetries}...${c.reset}`);
          i--; // Retry same step
          continue;
        }
        
        step.status = "failed";
        
        // Try to continue with next steps if possible
        if (plan.totalRetries >= cfg.maxTotalRetries) {
          console.log(`${c.red}✗ Max retry limit reached${c.reset}`);
          plan.status = "failed";
          break;
        }
      }
    }

    // 3. Final check
    const allDone = plan.steps.every(s => s.status === "done" || s.status === "skipped");
    plan.status = allDone ? "done" : "failed";
    plan.completedAt = new Date().toISOString();

    // Summary
    printSummary(plan);
    
    return plan;

  } catch (error: any) {
    plan.status = "failed";
    console.log(`${c.red}✗ Agent failed: ${error.message}${c.reset}`);
    return plan;
  }
}

/**
 * Plan oluştur - AI'dan adımları al
 */
async function createPlan(
  model: any,
  goal: string,
  codebaseContext: string
): Promise<AgentStep[]> {
  const prompt = getAgentPlanPrompt(goal, codebaseContext);

  const chatSession = model.startChat({ history: [] });
  const result = await sendMessageWithRetry(chatSession, prompt, "agent plan");
  const text = result.response.text();
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Plan oluşturulamadı");
  
  const data = JSON.parse(jsonMatch[0]);
  
  return data.steps.map((s: any) => ({
    id: s.id,
    description: s.description,
    status: "pending" as const,
    retries: 0
  }));
}

/**
 * Tek bir adımı uygula
 */
async function executeStep(
  model: any,
  step: AgentStep,
  plan: AgentPlan,
  codebaseContext: string
): Promise<string> {
  const previousSteps = plan.steps
    .filter(s => s.status === "done")
    .map(s => `✓ ${s.description}`)
    .join("\n");

  const prompt = getAgentStepPrompt(plan.goal, step.description, previousSteps, codebaseContext);

  const chatSession = model.startChat({ history: [] });
  
  // Send message and handle function calls
  let response = await sendMessageWithRetry(chatSession, prompt, "agent step");
  let iterations = 0;
  const maxIterations = 10;
  
  while (iterations < maxIterations) {
    const fcs = response.response.functionCalls();
    
    if (!fcs?.length) break;
    
    // Execute tools
    const responseParts: any[] = [];
    
    for (const fc of fcs) {
      console.log(`${c.dim}  ⏺ ${fc.name}${c.reset}`);
      const result = await executeTool(fc.name, fc.args as Record<string, any>);
      
      // Show truncated result
      const lines = result.split("\n");
      if (lines.length > 3) {
        console.log(`${c.dim}    ${lines[0]}${c.reset}`);
      }
      
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: { result }
        }
      });
    }
    
    // Continue conversation
    response = await sendMessageWithRetry(chatSession, responseParts, "agent continue");
    iterations++;
  }
  
  return response.response.text() || "Step completed";
}

/**
 * Hataları kontrol et ve düzelt
 * skipDependencyErrors: true ise "Cannot find module" hatalarını atla
 */
async function checkAndFix(
  model: any,
  codebaseContext: string,
  skipDependencyErrors: boolean = true
): Promise<boolean> {
  // Get recently modified files (simplified - check common patterns)
  const cwd = process.cwd();
  const filesToCheck: string[] = [];
  
  // Check src folder for TS files
  const srcDir = path.join(cwd, "src");
  if (fs.existsSync(srcDir)) {
    try {
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
      for (const file of files) {
        if (typeof file === "string" && (file.endsWith(".ts") || file.endsWith(".tsx"))) {
          filesToCheck.push(path.join("src", file));
        }
      }
    } catch {}
  }
  
  // Also check root TS files
  try {
    const rootFiles = fs.readdirSync(cwd);
    for (const file of rootFiles) {
      if (file.endsWith(".ts") || file.endsWith(".tsx")) {
        filesToCheck.push(file);
      }
    }
  } catch {}
  
  if (filesToCheck.length === 0) return false;
  
  try {
    const result = await getDiagnostics(filesToCheck.slice(0, 10)); // Max 10 files
    
    // Filter out non-actionable errors before formatting
    const filteredDiagnostics = result.diagnostics.filter(d => {
      // Skip node_modules errors
      if (d.file.includes("node_modules")) return false;
      
      // Skip JSX/tsx config errors (Vite handles this at runtime)
      if (d.message.includes("--jsx") || d.message.includes("jsx flag")) return false;
      
      // Skip module resolution errors (usually dependency issues)
      if (skipDependencyErrors) {
        if (d.message.includes("Cannot find module")) return false;
        if (d.message.includes("Could not find a declaration file")) return false;
        if (d.message.includes("has no exported member")) return false;
        if (d.message.includes("Cannot find namespace")) return false;
        if (d.message.includes("esModuleInterop")) return false;
      }
      
      return true;
    });
    
    // If no real errors after filtering, skip
    if (filteredDiagnostics.length === 0) {
      return false;
    }
    
    // Format only filtered diagnostics
    const filteredResult = {
      ...result,
      diagnostics: filteredDiagnostics,
      hasErrors: filteredDiagnostics.some(d => d.severity === "error")
    };
    const output = formatDiagnostics(filteredResult);
    
    if (filteredResult.hasErrors) {
      console.log(`${c.yellow}⚠️ Hatalar bulundu, düzeltiliyor...${c.reset}`);
      
      // Ask AI to fix
      const fixPrompt = getFixErrorsPrompt(output, codebaseContext);

      const chatSession = model.startChat({ history: [] });
      let response = await sendMessageWithRetry(chatSession, fixPrompt, "agent fix");
      
      // Handle function calls for fixing
      let iterations = 0;
      while (iterations < 5) {
        const fcs = response.response.functionCalls();
        if (!fcs?.length) break;
        
        const responseParts: any[] = [];
        for (const fc of fcs) {
          console.log(`${c.dim}  🔧 ${fc.name}${c.reset}`);
          const result = await executeTool(fc.name, fc.args as Record<string, any>);
          responseParts.push({
            functionResponse: { name: fc.name, response: { result } }
          });
        }
        
        response = await sendMessageWithRetry(chatSession, responseParts, "agent fix continue");
        iterations++;
      }
      
      return true;
    }
  } catch (e) {
    // Ignore diagnostic errors
  }
  
  return false;
}

/**
 * Planı yazdır
 */
function printPlan(plan: AgentPlan): void {
  console.log(`${c.bold}Plan:${c.reset}`);
  for (const step of plan.steps) {
    const icon = step.status === "done" ? "✓" : 
                 step.status === "running" ? "→" :
                 step.status === "failed" ? "✗" : "○";
    const color = step.status === "done" ? c.green :
                  step.status === "running" ? c.blue :
                  step.status === "failed" ? c.red : c.dim;
    console.log(`${color}  ${icon} ${step.id}. ${step.description}${c.reset}`);
  }
}

/**
 * Özet yazdır
 */
function printSummary(plan: AgentPlan): void {
  const done = plan.steps.filter(s => s.status === "done").length;
  const failed = plan.steps.filter(s => s.status === "failed").length;
  const duration = plan.completedAt 
    ? Math.round((new Date(plan.completedAt).getTime() - new Date(plan.startedAt).getTime()) / 1000)
    : 0;

  console.log(`\n${c.bold}━━━ Agent Summary ━━━${c.reset}`);
  console.log(`${c.dim}Goal:${c.reset} ${plan.goal}`);
  console.log(`${c.dim}Status:${c.reset} ${plan.status === "done" ? `${c.green}✓ Tamamlandı${c.reset}` : `${c.red}✗ Başarısız${c.reset}`}`);
  console.log(`${c.dim}Steps:${c.reset} ${done}/${plan.steps.length} (${failed} failed)`);
  console.log(`${c.dim}Retries:${c.reset} ${plan.totalRetries}`);
  console.log(`${c.dim}Duration:${c.reset} ${duration}s`);
  
  if (failed > 0) {
    console.log(`\n${c.red}Failed steps:${c.reset}`);
    for (const step of plan.steps.filter(s => s.status === "failed")) {
      console.log(`  ${c.red}✗ ${step.id}. ${step.description}${c.reset}`);
      if (step.error) console.log(`    ${c.dim}${step.error}${c.reset}`);
    }
  }
}

/**
 * Spec'ten Agent Mode başlat
 */
export async function runAgentFromSpec(
  model: any,
  spec: any,
  codebaseContext: string,
  config: Partial<AgentConfig> = {}
): Promise<AgentPlan> {
  // Convert spec tasks to agent steps
  const steps: AgentStep[] = spec.tasks
    .filter((t: any) => t.status === "pending")
    .map((t: any, i: number) => ({
      id: i + 1,
      description: `${t.title}: ${t.description}`,
      status: "pending" as const,
      retries: 0
    }));

  const plan: AgentPlan = {
    goal: spec.title,
    steps,
    status: "executing",
    startedAt: new Date().toISOString(),
    totalRetries: 0,
    maxRetries: config.maxTotalRetries || DEFAULT_CONFIG.maxTotalRetries
  };

  console.log(`\n${c.magenta}${c.bold}🤖 AGENT MODE (from Spec)${c.reset}`);
  console.log(`${c.dim}Spec: ${spec.title}${c.reset}`);
  console.log(`${c.dim}Tasks: ${steps.length} pending${c.reset}\n`);

  // Execute using same logic
  return runAgentMode(model, spec.title, codebaseContext, {
    ...config,
    // Override plan creation - use spec tasks directly
  });
}
