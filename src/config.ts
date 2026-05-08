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
  groqApiKey: req("GROQ_API_KEY"),
  serpApiKey: req("SERPAPI_KEY"),
  groqBaseUrl: "https://api.groq.com/openai/v1",
  groqModel: opt("GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"),

  ownerJids: opt("OWNER_JIDS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

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
