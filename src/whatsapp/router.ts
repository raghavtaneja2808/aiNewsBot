import { log } from "../util/log.js";
import { getSocket } from "./socket.js";
import { sendText } from "./send.js";
import { runAgent } from "../agent/agent.js";
import { runCommand, isCommand } from "../commands/registry.js";
import { getOrCreateGroup } from "../agent/tools/settings.js";
import { db } from "../store/db.js";

export type IncomingMessage = {
  /** group JID (chat) — works for 1:1 too */
  chatJid: string;
  /** sender JID — in 1:1 chats this equals chatJid */
  senderJid: string;
  text: string;
  isGroup: boolean;
  mentionsMe: boolean;
  repliesToMe: boolean;
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
  // Strip device suffix (`:NN`) — Baileys sometimes attaches it. We want bare JID.
  return jid.replace(/:\d+@/, "@");
}

function parse(m: any, ownJid: string): IncomingMessage | null {
  const chatJid = m?.key?.remoteJid as string | undefined;
  if (!chatJid) return null;
  if (chatJid === "status@broadcast") return null;
  if (m?.key?.fromMe) return null;

  const text = extractText(m).trim();
  if (!text) return null;

  const isGroup = chatJid.endsWith("@g.us");
  const senderJid = normalizeJid(isGroup ? m.key.participant : chatJid);

  const ctxInfo =
    m.message?.extendedTextMessage?.contextInfo ?? m.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;
  const mentioned: string[] = ctxInfo?.mentionedJid ?? [];
  const quotedFrom = normalizeJid(ctxInfo?.participant);

  const own = normalizeJid(ownJid);
  const mentionsMe = mentioned.map(normalizeJid).includes(own);
  const repliesToMe = quotedFrom === own;

  return {
    chatJid,
    senderJid,
    text,
    isGroup,
    mentionsMe,
    repliesToMe,
    raw: m,
  };
}

function shouldRespond(m: IncomingMessage): boolean {
  if (!m.isGroup) return true;             // 1:1: always respond
  if (isCommand(m.text)) return true;      // slash command in group
  if (m.mentionsMe || m.repliesToMe) return true;
  return false;
}

export async function handleMessage(rawMsg: any): Promise<void> {
  const sock = getSocket();
  const ownJid = sock.user?.id ?? "";

  const m = parse(rawMsg, ownJid);
  if (!m) return;

  const wasNewGroup = await ensureGroupOnboarded(m);
  if (!shouldRespond(m)) return;

  log.info(
    { chat: m.chatJid, sender: m.senderJid, isGroup: m.isGroup, cmd: isCommand(m.text), text: m.text.slice(0, 80) },
    "incoming",
  );

  // Strip a leading bot mention so the agent doesn't see "@bot ..." literally.
  const cleaned = m.text.replace(/^@\d+\s+/, "").trim();

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
  }

  // Send the onboarding card *after* the actual reply so the first response feels natural.
  if (wasNewGroup && m.isGroup) {
    await sendText(m.chatJid, onboardingCard()).catch(() => {});
  }
}

async function ensureGroupOnboarded(m: IncomingMessage): Promise<boolean> {
  // Returns true if we just created the group config (i.e. this is the first message we see for this chat).
  const d = await db();
  const exists = d.data.groups.some((g) => g.jid === m.chatJid);
  await getOrCreateGroup(m.chatJid);
  return !exists;
}

function onboardingCard(): string {
  return [
    "👋 *Hi! I'm AINewsBot.*",
    "I'll send a deep AI-news digest twice a day, and I can handle reminders, URL summaries, and quick questions.",
    "",
    "Quick start:",
    "• `/set-timezone Asia/Kolkata` (or your IANA tz)",
    "• `/digest-times 08:00 20:00`",
    "• `/help` to see everything",
    "",
    "You can also just talk to me normally — \"summarize https://...\", \"remind me in 30m to eat\", \"what's new in AI today\".",
  ].join("\n");
}
