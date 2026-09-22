// Presence-only check for sensitive config files (.env.local, .mcp.json).
// Outputs booleans / metadata only — never the actual secret values.
// Safe to run inside Claude Code: its output goes back to the model but
// contains no keys or tokens.

import fs from "fs";

function checkEnv() {
  try {
    const content = fs.readFileSync(".env.local", "utf8");
    const has = (k) => new RegExp("^" + k + "=.+", "m").test(content);
    const hasPrefix = (k, p) =>
      new RegExp("^" + k + "=" + p, "m").test(content);
    return {
      exists: true,
      url: has("NEXT_PUBLIC_SUPABASE_URL"),
      publishable: has("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      secret: has("SUPABASE_SECRET_KEY"),
      publishable_prefix_ok: hasPrefix(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "sb_publishable_"
      ),
      secret_prefix_ok: hasPrefix("SUPABASE_SECRET_KEY", "sb_secret_"),
    };
  } catch {
    return { exists: false };
  }
}

function checkMcp() {
  try {
    const content = fs.readFileSync(".mcp.json", "utf8");
    return {
      exists: true,
      has_project_id_placeholder: content.includes("<PROJECT_ID>"),
      has_pat_placeholder: content.includes("<SUPABASE_PERSONAL_ACCESS_TOKEN>"),
      has_read_only_flag: content.includes("read_only=true"),
    };
  } catch {
    return { exists: false };
  }
}

console.log(
  JSON.stringify(
    {
      env_local: checkEnv(),
      mcp_json: checkMcp(),
    },
    null,
    2
  )
);
