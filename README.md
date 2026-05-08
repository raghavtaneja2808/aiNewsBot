# AINewsBot

A WhatsApp bot that pushes a deep AI-news digest to configured groups twice a day, and acts as a conversational agent (function-calling) for reminders, URL summaries, and quick questions.

- **WhatsApp transport:** [Baileys](https://github.com/WhiskeySockets/Baileys)
- **Search:** SerpAPI (Google)
- **Scraping:** axios + cheerio + Mozilla Readability
- **LLM:** Groq with `meta-llama/llama-4-scout-17b-16e-instruct`
- **Agent runtime:** OpenAI Agents SDK (`@openai/agents`) pointed at Groq's OpenAI-compatible endpoint
- **Storage:** lowdb (single JSON file)
- **Process supervisor:** PM2

## Setup

```bash
git clone <this repo> aiNewsBot
cd aiNewsBot
cp .env.example .env       # fill in GROQ_API_KEY and SERPAPI_KEY
npm ci
npm run build
```

## Running locally (dev)

```bash
npm run dev
```

A QR code will print in the terminal. On your phone: WhatsApp → *Linked devices* → *Link a device* → scan. Auth state is then persisted in `data/auth/`, so subsequent restarts are silent.

## Running on a Linux server with PM2

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup       # follow the printed command to install the systemd unit
pm2 logs ai-news-bot   # for the QR scan and ongoing logs
```

To update:

```bash
git pull && npm ci && npm run build && pm2 restart ai-news-bot
```

## How it works

1. On any message in a group, the bot auto-registers a `GroupConfig` (default `UTC`, digest times `08:00,20:00`, no topics).
2. Twice a day, per-group `node-cron` jobs run `runDigest`: SerpAPI → scrape top 5 → per-article Groq summary → consolidated WhatsApp post → stored in lowdb.
3. Slash commands route through `commands/registry.ts`. Anything else routes to the agent (`agent/agent.ts`), which has every command available as a tool.
4. Reminders are scanned every 30s and fired when due.

## Commands

Send `/help` in any chat for the full menu. Highlights:

| Command | Behavior |
|---|---|
| `/help` | Help menu |
| `/news` | Run a digest now |
| `/stop` / `/start` | Pause / resume daily digests |
| `/set-timezone <IANA>` | e.g. `Asia/Kolkata` |
| `/digest-times HH:MM HH:MM` | Schedule (group-local) |
| `/topics add\|remove\|list` | Customize what counts as "AI news" for this group |
| `/remind <when> <message>` | NL or ISO times |
| `/reminders` | List pending |
| `/cancel <id>` | Cancel reminder |
| `/summarize <url>` | One-shot URL summary |
| `/history` | Recent digests |
| `/settings` | Show group config |

You can also just *talk* to the bot. Examples:

- "what's new in AI today?" → triggers the digest
- "remind me in 30m to drink water"
- "summarize https://example.com/article"
- "switch our timezone to Europe/Berlin"

In group chats, the bot only responds when (a) the message starts with `/`, (b) you `@`-mention it, or (c) you reply to one of its messages. In 1:1 chats, it always responds.

## Permissions

Currently anyone in the group can run any command. To add an owner-only gate later, fill `OWNER_JIDS` in `.env` and check it in `runCommand`.

## Layout

```
src/
  index.ts              # boot order
  config.ts             # env loading
  whatsapp/             # Baileys socket, sender, message router
  commands/             # slash command parsing + dispatch + help text
  agent/                # OpenAI Agents SDK setup + Groq client
  agent/tools/          # search, scrape, summarize, digest, reminders, settings, history
  scheduler/            # node-cron per-group digest jobs + reminder tick
  store/                # lowdb wrapper + types
  util/                 # logger, time helpers
data/
  db.json               # lowdb file (gitignored)
  auth/                 # Baileys multi-file auth state (gitignored)
```
