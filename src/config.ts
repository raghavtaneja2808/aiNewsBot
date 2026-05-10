import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export const config = {
  llmApiKey: req("VENICE_API_KEY"),
  serpApiKey: req("SERPAPI_KEY"),
  llmBaseUrl: opt("LLM_BASE_URL", "https://api.venice.ai/api/v1"),
  llmModel: opt("VENICE_MODEL", "llama-3.3-70b"),

  // Used only for short tool-narration messages ("Pulling latest headlines…").
  // Optional — leave blank to disable narrations entirely.
  groqApiKey: opt("GROQ_API_KEY", ""),
  groqBaseUrl: opt("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
  groqNarrationModel: opt("GROQ_NARRATION_MODEL", "llama-3.1-8b-instant"),

  ownerJids: opt("OWNER_JIDS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Static allowlist of WhatsApp group JIDs (comma-separated). Always allowed.
  allowedGroupJids: opt("ALLOWED_GROUP_JIDS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Secret used by the runtime enable command:  /set group-<ENABLE_SECRET>
  // sent in a group will add that group to the persistent allowlist.
  // Leave empty to disable runtime enabling entirely (env-only allowlist).
  enableSecret: opt("ENABLE_SECRET", ""),

  defaultTimezone: opt("DEFAULT_TIMEZONE", "UTC"),
  defaultDigestTimes: opt("DEFAULT_DIGEST_TIMES", "08:00,20:00")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  digestResults: Math.max(1, parseInt(opt("DIGEST_RESULTS", "5"), 10)),

  logLevel: opt("LOG_LEVEL", "info"),

  dbPath: "data/db.json",
  authDir: "data/auth",
} as const;
