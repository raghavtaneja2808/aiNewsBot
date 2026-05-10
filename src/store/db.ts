import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Db } from "./types.js";

let _db: Low<Db> | null = null;

const defaultData: Db = {
  groups: [],
  reminders: [],
  digests: [],
  enabledGroups: [],
  users: [],
  messages: [],
};

export async function db(): Promise<Low<Db>> {
  if (_db) return _db;
  await mkdir(path.dirname(config.dbPath), { recursive: true });
  const adapter = new JSONFile<Db>(config.dbPath);
  const inst = new Low<Db>(adapter, defaultData);
  try {
    await inst.read();
  } catch {
    // Empty or malformed file (lowdb throws on JSON.parse("")). Reset to defaults.
    inst.data = { ...defaultData };
  }
  inst.data ||= defaultData;
  // Ensure all top-level arrays exist (in case file was hand-edited).
  inst.data.groups ||= [];
  inst.data.reminders ||= [];
  inst.data.digests ||= [];
  inst.data.enabledGroups ||= [];
  inst.data.users ||= [];
  inst.data.messages ||= [];
  await inst.write();
  _db = inst;
  return inst;
}

export async function persist(): Promise<void> {
  if (_db) await _db.write();
}
