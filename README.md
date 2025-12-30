# Luva

An agentic coding assistant that runs in your terminal.

Luva understands your codebase, executes commands, edits files, and helps you build faster — all through natural conversation.

## Quick Start

```bash
npm install -g luva-cli
luva
```

On first run, you'll be prompted for your [Gemini API key](https://aistudio.google.com/apikey).

## What can Luva do?

**Read and write files** — Luva can explore your codebase, understand context, and make edits across multiple files.

**Run commands** — Execute shell commands, start dev servers, run tests. Use `!npm run dev` to run commands directly.

**Smart context** — Luva automatically finds relevant files based on your question using embeddings. No need to manually specify what to look at.

**Generate projects** — Scaffold new projects with modern stacks: `react-vite`, `next`, `express`, `fastify`, `hono`, and more.

**Generate tests** — Create test files automatically with `/test gen <file>`.

**Spec-driven development** — Break down features into requirements, design, and tasks with `/spec`.

**Agent Mode** — Fully autonomous task execution. Describe what you want, Luva plans and implements it automatically.

**Skills System** — Domain-specific knowledge that activates automatically based on your task.

## Features

### 🎯 Multi-Skill Support

Luva can activate multiple skills simultaneously based on your message:

```
> full-stack dashboard tasarla

🎯 Skills: frontend-design, backend-design
```

Skills are automatically matched based on triggers in your message. For example:
- "sayfa", "button", "hover", "css" → frontend-design
- "api", "database", "endpoint" → backend-design
- Both present → Both skills activate

### 📁 Custom Skills

Create your own skills in `~/.config/luva/skills/`:

```yaml
---
inclusion: auto
triggers: nextjs, next.js, app router, server components
---

# Next.js Expert

Your skill content here...
```

**Inclusion modes:**
- `auto` — Activates when triggers match (default)
- `always` — Always included in every prompt
- `manual` — Only when explicitly requested

### 🖼️ Image Support

Include images in your prompts:

```
> @img:screenshot.png bu tasarımı koda çevir
```

Supported formats: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`

### 🔍 Smart Diagnostics

- TSX/JSX files skip basic bracket checking (JSX syntax aware)
- Vite projects use `tsconfig.app.json` automatically
- `node_modules` errors are filtered out
- Only actionable errors are shown

## Usage

```
> explain this codebase

◆ This is a TypeScript Node.js project with...

> add error handling to the api routes

⏺ read_file
⏺ edit_file

◆ Done. Added try-catch blocks and proper error responses.

> !npm run dev

🚀 Server running on http://localhost:3000
```

### Agent Mode

```
> /agent add user authentication with JWT

🤖 AGENT MODE
Goal: add user authentication with JWT

🎯 Skills aktif: backend-design

Plan:
  ○ 1. Install jsonwebtoken and bcrypt packages
  ○ 2. Create auth middleware
  ○ 3. Create user model
  ○ 4. Create auth routes (login, register)
  ○ 5. Add protected route example

━━━ Step 1/5 ━━━
Install dependencies...
  ⏺ run_command
✓ Step 1 completed
...

━━━ Agent Summary ━━━
Status: ✓ Completed
Steps: 5/5 (0 failed)
Duration: 45s
```

### Commands

```
?               Help
exit            Quit
clear           Clear conversation
config          Open config folder

!<command>      Run shell command
@file:path      Include file in context
@folder:path    Include folder
@img:path       Include image (png/jpg/webp)
@git            Include git diff

/agent <goal>   Run goal autonomously (plan → execute → fix)
/agent spec     Run active spec automatically

/spec new <t>   Start new spec
/spec req       Generate requirements
/spec design    Generate design decisions
/spec tasks     Generate implementation tasks
/spec next      Implement next task
/spec auto      Auto-implement all tasks

/new list       List project templates
/new <t> <n>    Create new project
/test gen <f>   Generate test file

si              Build smart index
skills          List available skills
ps              List background processes
mcp             Manage MCP servers
```

## Skills System

Skills provide domain-specific knowledge and guidelines. They activate automatically based on message content.

### Built-in Trigger Patterns

| Domain | Triggers |
|--------|----------|
| Frontend | sayfa, page, ui, component, button, card, hover, css, tailwind, react, animation |
| Backend | api, endpoint, database, server, rest, graphql, schema, migration |
| Mobile | mobile, app, ios, android, react native, flutter |

### Creating Custom Skills

1. Create a folder in `~/.config/luva/skills/your-skill-name/`
2. Add a `SKILL.md` file:

```markdown
---
inclusion: auto
triggers: keyword1, keyword2, keyword3
---

# Your Skill Name

Your skill instructions and guidelines here...

## When to use
- Scenario 1
- Scenario 2

## Guidelines
- Guideline 1
- Guideline 2
```

### Inclusion Modes

| Mode | Description |
|------|-------------|
| `auto` | Activates when triggers match the user's message |
| `always` | Always included in system prompt (shown with 🔒 in `skills` command) |
| `manual` | Only activates when explicitly mentioned |

## Spec System

Break down complex features into structured specs:

```bash
/spec new Payment Integration
> Implement Stripe payments. See #[[file:docs/api.yaml]] for API spec.

/spec req      # Requirements with acceptance criteria
/spec design   # Technical design decisions
/spec tasks    # Implementation tasks

/spec next     # One task at a time
/spec auto     # All tasks automatically
```

### File References

Reference external files in your spec description:

```
#[[file:openapi.yaml]]     # API specification
#[[file:schema.prisma]]    # Database schema
#[[file:docs/design.md]]   # Design document
```

## Installation

```bash
# From npm
npm install -g luva-cli

# From source
git clone https://github.com/furkanigsiz/Luvacli.git
cd Luvacli/luva-cli
npm install
npm run build
npm link
```

## Configuration

Config lives in `~/.config/luva/`:

```
~/.config/luva/
├── .env              # GEMINI_API_KEY
├── skills/           # Custom skills
│   ├── frontend-design/
│   │   └── SKILL.md
│   └── backend-design/
│       └── SKILL.md
├── context/          # Global context files (.md)
├── history/          # Conversation history
└── mcp.json          # MCP server config
```

## Requirements

- Node.js 18+
- Gemini API key

## License

MIT
