import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { Db } from "./types.js";

let _db: Low<Db> | null = null;

const defaultData: Db = { groups: [], reminders: [], digests: [] };

export async function db(): Promise<Low<Db>> {
  if (_db) return _db;
  await mkdir(path.dirname(config.dbPath), { recursive: true });
  const adapter = new JSONFile<Db>(config.dbPath);
  const inst = new Low<Db>(adapter, defaultData);
  await inst.read();
  inst.data ||= defaultData;
  // Ensure all top-level arrays exist (in case file was hand-edited).
  inst.data.groups ||= [];
  inst.data.reminders ||= [];
  inst.data.digests ||= [];
  await inst.write();
  _db = inst;
  return inst;
}

export async function persist(): Promise<void> {
  if (_db) await _db.write();
}
