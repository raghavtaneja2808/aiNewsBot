import * as chrono from "chrono-node";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatInTz(iso: string, tz: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "in 30m", "after 2 hours", "30s from now", "5min" — all map to ref + duration.
const RELATIVE_DURATION_RE =
  /^(?:in\s+|after\s+)?(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)(?:\s+from\s+now|\s+later)?$/i;

function unitToMs(unit: string): number | null {
  const u = unit.toLowerCase();
  if (/^s(?:ec|ecs|econd|econds)?$/.test(u)) return 1000;
  if (/^m(?:in|ins|inute|inutes)?$/.test(u)) return 60_000;
  if (/^h(?:r|rs|our|ours)?$/.test(u)) return 3_600_000;
  if (/^d(?:ay|ays)?$/.test(u)) return 86_400_000;
  if (/^w(?:k|ks|eek|eeks)?$/.test(u)) return 7 * 86_400_000;
  return null;
}

function parseRelativeDuration(input: string, ref: Date): Date | null {
  const m = input.trim().match(RELATIVE_DURATION_RE);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const ms = unitToMs(m[2]);
  if (ms == null || !Number.isFinite(n)) return null;
  return new Date(ref.getTime() + n * ms);
}

/**
 * Parse a natural-language or ISO time string against the given IANA timezone.
 * Returns ISO UTC of the resolved instant, or null on failure.
 *
 * Three layers:
 *   1. ISO fast-path
 *   2. Relative duration ("in 30m", "after 2 hours") — TZ-independent, deterministic.
 *   3. chrono fallback for absolute times ("9am", "tomorrow 18:30") — interpreted
 *      in the user's TZ rather than the machine's local TZ.
 */
export function parseWhen(input: string, tz: string, ref: Date = new Date()): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. ISO fast-path
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();

  // 2. Relative-duration fast-path (handles "in 1m", "after 1 min", "30s from now", ...)
  const rel = parseRelativeDuration(trimmed, ref);
  if (rel) return rel.toISOString();

  // 3. chrono for absolute / calendar expressions
  const result = chrono.parse(trimmed, ref, { forwardDate: true })[0];
  if (!result) return null;
  const parsed = result.start.date();
  if (Number.isNaN(parsed.getTime())) return null;

  const start = result.start;
  const isAbsolute =
    start.isCertain("hour") ||
    start.isCertain("day") ||
    start.isCertain("weekday") ||
    start.isCertain("month");

  // If chrono didn't see anything absolute, treat it as already-resolved relative.
  if (!isAbsolute) return parsed.toISOString();

  // Shift the moment so chrono's wall-clock output is read in `tz` instead of
  // the machine's local TZ.
  const tzRef = new Date(ref.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = tzRef.getTime() - ref.getTime();
  const corrected = new Date(parsed.getTime() - offsetMs);
  return corrected.toISOString();
}

export function shortId(prefix = "r"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}
