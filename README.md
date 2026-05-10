# AINewsBot

A WhatsApp bot that pushes a deep AI-news digest to configured groups twice a day, and acts as a conversational agent (function-calling) for reminders, URL summaries, and quick questions.

- **WhatsApp transport:** [Baileys](https://github.com/WhiskeySockets/Baileys)
- **Search:** SerpAPI (Google)
- **Scraping:** axios + cheerio + Mozilla Readability
- **LLM:** Venice AI (`zai-org-glm-4.6` by default; any OpenAI-compatible endpoint works via `LLM_BASE_URL`)
- **Agent runtime:** OpenAI Agents SDK (`@openai/agents`) pointed at the configured OpenAI-compatible endpoint
- **Storage:** lowdb (single JSON file)
- **Process supervisor:** PM2

## Setup

```bash
git clone <this repo> aiNewsBot
cd aiNewsBot
cp .env.example .env       # fill in VENICE_API_KEY and SERPAPI_KEY
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

## Safety model

The bot is **off by default everywhere**. It only reads or responds in WhatsApp groups whose JID you have explicitly added to `ALLOWED_GROUP_JIDS` in `.env`.

- **Direct messages (1:1 chats):** ignored, always. The bot will not respond.
- **Groups not on the allowlist:** ignored. The first message from each unknown group/chat is logged once at info level so you can copy the JID — nothing else.
- **Groups on the allowlist:** normal behavior — slash commands, mentions, replies, and the scheduled digests.

### How to enable a group

1. Add the bot's WhatsApp number to the group.
2. Send any message in the group (e.g. `hi`).
3. On the host, run `pm2 logs ai-news-bot` (or watch the `npm run dev` terminal). You'll see a line like:

   ```
   ignored message from non-allowlisted group  chatJid=1203630xxxxxxxxxxx@g.us
   ```

4. Copy that JID into `.env`:

   ```
   ALLOWED_GROUP_JIDS=1203630xxxxxxxxxxx@g.us,120363yyyyyyyyyyy@g.us
   ```

5. Restart: `pm2 restart ai-news-bot` (or restart the dev process). The bot will now respond in that group and start its scheduled digests there.

To remove a group, drop the JID from the env var and restart. Existing config in `data/db.json` is harmless — it'll be ignored until the JID is allowlisted again.

## How it works

1. Incoming message → router checks `ALLOWED_GROUP_JIDS`. DMs and unknown groups are dropped.
2. For an allowed group, on first message a `GroupConfig` is lazily created (default `UTC`, digest times `08:00,20:00`, no topics).
3. Twice a day, per-group `node-cron` jobs run `runDigest`: SerpAPI → scrape top 5 → per-article LLM summary → consolidated WhatsApp post → stored in lowdb.
4. Slash commands route through `commands/registry.ts`. Anything else routes to the agent (`agent/agent.ts`), which has every command available as a tool.
5. Reminders are scanned every 30s and fired when due.

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

In allowlisted groups, the bot only responds when (a) the message starts with `/`, (b) you `@`-mention it, or (c) you reply to one of its messages. The bot never responds in DMs or in non-allowlisted groups.

## Permissions

Currently anyone in the group can run any command. To add an owner-only gate later, fill `OWNER_JIDS` in `.env` and check it in `runCommand`.

## Layout

```
src/
  index.ts              # boot order
  config.ts             # env loading
  whatsapp/             # Baileys socket, sender, message router
  commands/             # slash command parsing + dispatch + help text
  agent/                # OpenAI Agents SDK setup + LLM client (Venice by default)
  agent/tools/          # search, scrape, summarize, digest, reminders, settings, history
  scheduler/            # node-cron per-group digest jobs + reminder tick
  store/                # lowdb wrapper + types
  util/                 # logger, time helpers
data/
  db.json               # lowdb file (gitignored)
  auth/                 # Baileys multi-file auth state (gitignored)
```
