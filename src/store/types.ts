export type GroupConfig = {
  jid: string;
  /** IANA timezone used ONLY for the daily digest schedule. Per-user TZs
   *  (UserPref.timezone) are used for reminders and "what time is it" queries. */
  timezone: string;
  digestTimes: string[];
  paused: boolean;
  topics: string[];
  createdAt: string;
};

export type UserPref = {
  /** Bare WhatsApp JID of the user (phone or @lid form, normalized). */
  jid: string;
  /** User's preferred IANA timezone. Used for reminders & clock. */
  timezone: string;
  updatedAt: string;
};

export type ReminderStatus = "pending" | "fired" | "cancelled";

export type Reminder = {
  id: string;
  groupJid: string;
  userJid: string;
  fireAt: string;
  message: string;
  status: ReminderStatus;
  createdAt: string;
};

export type DigestStory = {
  title: string;
  url: string;
  summary: string;
};

export type DigestEntry = {
  groupJid: string;
  sentAt: string;
  stories: DigestStory[];
};

export type MessageRecord = {
  /** Source: "in" = received, "out" = sent by the bot, "history" = backfilled. */
  source: "in" | "out" | "history";
  groupJid: string;
  /** Sender JID (bare, no device suffix). For "out" messages this is the bot's own JID. */
  senderJid: string;
  /** Display name if available (pushName). */
  senderName?: string;
  /** Plain text body (caption for media). Empty bodies are not stored. */
  text: string;
  /** Unix-ms timestamp. */
  ts: number;
  /** WhatsApp message id, if known. Used for de-duping. */
  id?: string;
};

export type Db = {
  groups: GroupConfig[];
  reminders: Reminder[];
  digests: DigestEntry[];
  /** Group JIDs enabled at runtime via the secret /set command. Persisted so
   *  enables survive restarts. Effective allowlist = env ALLOWED_GROUP_JIDS ∪ this. */
  enabledGroups: string[];
  users: UserPref[];
  /** Per-group message log, capped at MESSAGES_PER_GROUP_CAP. Used as conversation
   *  context for the agent. Oldest entries are pruned on insert. */
  messages: MessageRecord[];
};
