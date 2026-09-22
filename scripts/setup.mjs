#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const c = {
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  b: (s) => `\x1b[34m${s}\x1b[0m`,
  m: (s) => `\x1b[35m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

const step = (n, total, title) =>
  console.log(`\n${c.c(`[${n}/${total}]`)} ${c.bold(title)}`);

console.log(`
${c.m("╔════════════════════════════════════════════╗")}
${c.m("║")}   ${c.bold("🎮 Game Changer — Template Setup")}        ${c.m("║")}
${c.m("║")}   ${c.dim("Bootstrapping your brand new project...")}  ${c.m("║")}
${c.m("╚════════════════════════════════════════════╝")}
`);

const TOTAL = 6;

const INITIAL_COMMIT_MSG = "chore: initial commit from game-changer template";

// A repo whose root commit is our own initial commit was created by a previous
// setup run — it's the student's project history, not the template's. Re-running
// setup must never delete it.
const gitInitializedBySetup = () => {
  try {
    const roots = execSync("git log --max-parents=0 --format=%s HEAD", {
      stdio: "pipe",
    })
      .toString()
      .split("\n");
    return roots.includes(INITIAL_COMMIT_MSG);
  } catch {
    return false;
  }
};

// 1. Purge old git history, init fresh
step(1, TOTAL, "Resetting git history (clearing template's history)");
const keptExistingRepo = existsSync(".git") && gitInitializedBySetup();
if (keptExistingRepo) {
  console.log(c.dim("  ✓ Git repo already initialized by setup — keeping your history"));
} else {
  if (existsSync(".git")) {
    rmSync(".git", { recursive: true, force: true });
    console.log(c.dim("  ✓ Old .git removed"));
  }
  run("git init -q -b main");
  console.log(c.g("  ✓ Fresh git repo initialized"));
}
// Strip the platform-sync workflow so the student's fresh repo doesn't try
// to run it on every push (it would fail on missing R2 secrets anyway).
if (existsSync(".github")) {
  rmSync(".github", { recursive: true, force: true });
  console.log(c.dim("  ✓ Old .github (template CI) removed"));
}

// 2. Project name → package.json (taken from folder name, no prompt)
step(2, TOTAL, "Setting project name from folder");
const folderName = process.cwd().split(/[\\/]/).pop() || "my-app";
const projectName = folderName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = projectName;
pkg.version = "0.1.0";
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(c.g(`  ✓ Project name: ${projectName}`));

// 3. Install deps
step(3, TOTAL, "Installing dependencies (may take a minute or two)");
if (!existsSync("node_modules")) {
  run("npm install");
} else {
  console.log(c.dim("  ✓ node_modules already present — skipping"));
}

// 4. .env.local + .mcp.json from examples
step(4, TOTAL, "Preparing config files (.env.local + .mcp.json)");
if (existsSync(".env.example") && !existsSync(".env.local")) {
  copyFileSync(".env.example", ".env.local");
  console.log(c.g("  ✓ Created .env.local (fill in the values later)"));
} else if (existsSync(".env.local")) {
  console.log(c.dim("  ✓ .env.local already exists — skipping"));
}
if (existsSync(".mcp.example.json") && !existsSync(".mcp.json")) {
  copyFileSync(".mcp.example.json", ".mcp.json");
  console.log(c.g("  ✓ Created .mcp.json (placeholders — /start-from-template will guide you)"));
} else if (existsSync(".mcp.json")) {
  console.log(c.dim("  ✓ .mcp.json already exists — skipping"));
}

// 5. Install Vercel Claude Code plugin (best-effort — requires claude/npx)
step(5, TOTAL, "Installing Vercel plugin for Claude Code (prep for deploy)");
try {
  run("npx -y plugins add vercel/vercel-plugin", { stdio: "pipe" });
  console.log(c.g("  ✓ Vercel plugin installed"));
} catch {
  console.log(c.y("  ! Plugin install failed — run manually: npx plugins add vercel/vercel-plugin"));
}

// 6. First commit — only for a fresh repo. On a re-run the repo already has
// the student's history and commits are theirs to make.
step(6, TOTAL, "Creating initial commit");
if (keptExistingRepo) {
  console.log(c.dim("  ✓ Repo already has commits — leaving your history untouched"));
} else {
  try {
    run("git add -A", { stdio: "pipe" });
    run(`git commit -q -m "${INITIAL_COMMIT_MSG}"`, { stdio: "pipe" });
    console.log(c.g("  ✓ Initial commit created"));
  } catch {
    console.log(c.y("  ! Could not create commit — git may not be configured yet (set git config user.email / user.name)"));
  }
}

// Done
console.log(`
${c.g("━".repeat(50))}
${c.bold("✅  All set! Your project is ready to roll")}
${c.g("━".repeat(50))}

${c.bold("🚀 Next steps:")}

  ${c.c("1.")} Start the dev server:
     ${c.y("npm run dev")}

  ${c.c("2.")} Open the project in Claude Code:
     ${c.y("claude")}

  ${c.c("3.")} Inside Claude Code, run:
     ${c.y("/start-from-template")}
     ${c.dim("(Full guide: connect Supabase + MCP + landing page)")}

  ${c.c("4.")} Fill in the values in:
     ${c.y(".env.local")}

${c.m("💡 Tip:")} Read ${c.bold("README.md")} for the full tour of what's in the template.

${c.dim("Good luck 🎮 Game Changer Time")}
`);
