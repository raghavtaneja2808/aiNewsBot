import { log } from "../util/log.js";
import { getSocket } from "./socket.js";
import { sendText, isSelfSentId, setTyping } from "./send.js";
import { runAgent } from "../agent/agent.js";
import { runCommand, isCommand } from "../commands/registry.js";
import { getOrCreateGroup } from "../agent/tools/settings.js";
import { config } from "../config.js";
import { isGroupAllowed, enableGroup, disableGroup } from "./allowlist.js";
import { rescheduleGroup } from "../scheduler/cron.js";
import { appendMessage } from "../store/messages.js";

export type IncomingMessage = {
  /** group JID (chat) — works for 1:1 too */
  chatJid: string;
  /** sender JID — in 1:1 chats this equals chatJid */
  senderJid: string;
  /** Sender's pushName if Baileys provided one. */
  senderName?: string;
  text: string;
  isGroup: boolean;
  /** True when the message was authored by the bot's own account (linked phone or self-sent). */
  fromMe: boolean;
  mentionsMe: boolean;
  repliesToMe: boolean;
  /** WhatsApp message id, used for de-duping in the message store. */
  msgId?: string;
  /** Original message timestamp in ms. */
  ts: number;
  raw: any;
};

function extractText(m: any): string {
  const msg = m?.message ?? {};
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    msg.ephemeralMessage?.message?.conversation ??
    msg.ephemeralMessage?.message?.extendedTextMessage?.text ??
    ""
  ).toString();
}

function normalizeJid(jid: string | null | undefined): string {
  if (!jid) return "";
  return jid.replace(/:\d+@/, "@");
}

function parse(m: any, ownJids: string[]): IncomingMessage | null {
  const chatJid = m?.key?.remoteJid as string | undefined;
  if (!chatJid) return null;
  if (chatJid === "status@broadcast") return null;

  // Bot's own outbound replies echo back as fromMe — drop those, but keep
  // messages typed on the linked phone (also fromMe but unknown id).
  if (m?.key?.fromMe && isSelfSentId(m?.key?.id)) return null;

  const text = extractText(m).trim();
  if (!text) return null;

  const isGroup = chatJid.endsWith("@g.us");
  const fromMe = !!m?.key?.fromMe;
  const senderJid = normalizeJid(isGroup ? m.key.participant : (fromMe ? ownJids[0] : chatJid));

  const ctxInfo =
    m.message?.extendedTextMessage?.contextInfo ?? m.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;
  const mentioned: string[] = (ctxInfo?.mentionedJid ?? []).map(normalizeJid);
  const quotedFrom = normalizeJid(ctxInfo?.participant);

  const ownSet = new Set(ownJids.map(normalizeJid).filter(Boolean));
  const mentionsMe = mentioned.some((j) => ownSet.has(j));
  const repliesToMe = ownSet.has(quotedFrom);

  const tsRaw = m?.messageTimestamp;
  const ts = typeof tsRaw === "number" ? tsRaw * 1000 : Number(tsRaw ?? 0) * 1000 || Date.now();

  return {
    chatJid,
    senderJid,
    senderName: typeof m?.pushName === "string" ? m.pushName : undefined,
    text,
    isGroup,
    fromMe,
    mentionsMe,
    repliesToMe,
    msgId: m?.key?.id,
    ts,
    raw: m,
  };
}

function shouldRespond(m: IncomingMessage): boolean {
  if (!m.isGroup) return false;
  // Slash commands only — mentions and replies-to-bot no longer trigger.
  // Use /ask <question> to talk to the agent in natural language.
  return isCommand(m.text);
}

// In-memory dedupe so we log each unknown chat JID at most once per process.
const loggedUnknownChats = new Set<string>();

const ENABLE_RE = /^\/set\s+group-(\S+)\s*$/i;
const DISABLE_RE = /^\/unset\s+group-(\S+)\s*$/i;

/**
 * Pre-allowlist intercept for the secret enable/disable commands.
 * Returns true if the message was handled (caller should stop processing).
 */
async function handleEnableSecret(m: IncomingMessage): Promise<boolean> {
  const enableMatch = m.text.match(ENABLE_RE);
  const disableMatch = m.text.match(DISABLE_RE);
  if (!enableMatch && !disableMatch) return false;
  if (!m.isGroup) return false; // never react in DMs, even silently

  // Enable secret not configured → silently drop. Don't reveal that the command exists.
  if (!config.enableSecret) return true;

  if (enableMatch) {
    const provided = enableMatch[1];
    if (provided !== config.enableSecret) {
      log.warn({ chatJid: m.chatJid, sender: m.senderJid }, "enable_group.bad_secret");
      return true; // wrong secret → silent
    }
    const { alreadyEnabled } = await enableGroup(m.chatJid);
    log.info({ chatJid: m.chatJid, sender: m.senderJid, alreadyEnabled }, "enable_group.ok");
    if (alreadyEnabled) {
      await sendText(m.chatJid, "✅ Already enabled in this group.").catch(() => {});
    } else {
      await getOrCreateGroup(m.chatJid);
      await rescheduleGroup(m.chatJid);
      await sendText(
        m.chatJid,
        "✅ *Enabled in this group.*\nDefault timezone is UTC and digests run at 08:00 / 20:00. Send `/help` to see everything, or `/set-timezone Asia/Kolkata` to localize.",
      ).catch(() => {});
    }
    return true;
  }

  // disableMatch
  const provided = disableMatch![1];
  if (provided !== config.enableSecret) {
    log.warn({ chatJid: m.chatJid, sender: m.senderJid }, "disable_group.bad_secret");
    return true;
  }
  const { wasEnabled, inEnv } = await disableGroup(m.chatJid);
  log.info({ chatJid: m.chatJid, sender: m.senderJid, wasEnabled, inEnv }, "disable_group.ok");
  if (inEnv) {
    await sendText(
      m.chatJid,
      "⚠️ This group is allowlisted via `ALLOWED_GROUP_JIDS` in .env, so I can't disable it from chat. Remove it from .env and restart.",
    ).catch(() => {});
  } else if (wasEnabled) {
    await rescheduleGroup(m.chatJid); // will clear the cron jobs since group is no longer allowed
    await sendText(m.chatJid, "🛑 Disabled in this group. I'll go quiet now.").catch(() => {});
  } else {
    await sendText(m.chatJid, "Wasn't enabled in this group anyway.").catch(() => {});
  }
  return true;
}

export async function handleMessage(rawMsg: any): Promise<void> {
  const sock = getSocket();
  // Bot has up to two identities in any given group; collect both.
  const u: any = sock.user ?? {};
  const ownJids = [u.id, u.lid].filter(Boolean) as string[];

  const m = parse(rawMsg, ownJids);
  if (!m) return;

  // Secret enable/disable runs BEFORE the allowlist check. Everything else is gated.
  if (await handleEnableSecret(m)) return;

  if (!(await isGroupAllowed(m.chatJid))) {
    if (!loggedUnknownChats.has(m.chatJid)) {
      loggedUnknownChats.add(m.chatJid);
      log.info(
        { chatJid: m.chatJid, isGroup: m.isGroup },
        m.isGroup
          ? "ignored message from non-allowlisted group — send `/set group-<ENABLE_SECRET>` in the group to enable, or add the JID to ALLOWED_GROUP_JIDS in .env"
          : "ignored DM — bot only responds in allowlisted groups",
      );
    }
    return;
  }

  // Lazy-create config for an allowed group on first message. No onboarding card —
  // the operator already opted this group in via .env.
  await getOrCreateGroup(m.chatJid);

  // Log every message in this allowed group (not just ones we respond to) so the
  // agent has full conversation context. Bot's own replies are captured in send.ts.
  await appendMessage({
    source: "in",
    groupJid: m.chatJid,
    senderJid: m.senderJid,
    senderName: m.senderName,
    text: m.text,
    ts: m.ts,
    id: m.msgId,
  }).catch((err) => log.warn({ err: String(err) }, "appendMessage failed"));

  if (!shouldRespond(m)) return;

  log.info(
    { chat: m.chatJid, sender: m.senderJid, cmd: isCommand(m.text), text: m.text.slice(0, 80) },
    "incoming",
  );

  // Strip a leading bot-mention so the agent doesn't see "@919... " or "@2003...@lid " literally.
  const cleaned = m.text.replace(/^@[\w@.]+\s+/, "").trim();

  // Show "typing…" while we work. Cleared in `finally`.
  await setTyping(m.chatJid, true);
  try {
    if (isCommand(cleaned)) {
      const reply = await runCommand(cleaned, { groupJid: m.chatJid, userJid: m.senderJid });
      if (reply) await sendText(m.chatJid, reply);
    } else {
      const reply = await runAgent(cleaned, { groupJid: m.chatJid, userJid: m.senderJid });
      if (reply) await sendText(m.chatJid, reply);
    }
  } catch (err) {
    log.error({ err: String(err) }, "router error");
    await sendText(m.chatJid, "Sorry — something went wrong handling that. Try /help.").catch(() => {});
  } finally {
    await setTyping(m.chatJid, false);
  }
}
