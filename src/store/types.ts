export type GroupConfig = {
  jid: string;
  timezone: string;
  digestTimes: string[];
  paused: boolean;
  topics: string[];
  createdAt: string;
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

export type Db = {
  groups: GroupConfig[];
  reminders: Reminder[];
  digests: DigestEntry[];
};
