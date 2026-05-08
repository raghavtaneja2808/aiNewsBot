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

/**
 * Parse a natural-language or ISO time string against the given IANA timezone.
 * Returns ISO UTC of the resolved instant, or null on failure.
 */
export function parseWhen(input: string, tz: string, ref: Date = new Date()): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // ISO fast-path
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();

  // Build a reference Date that represents "now in the group's tz" so chrono's
  // relative parsing ("tomorrow 9am") aligns with the user's wall clock.
  const tzRef = new Date(ref.toLocaleString("en-US", { timeZone: tz }));
  const offsetMs = tzRef.getTime() - ref.getTime();

  const result = chrono.parse(trimmed, ref, { forwardDate: true })[0];
  if (!result) return null;
  const parsed = result.start.date();
  if (Number.isNaN(parsed.getTime())) return null;

  // chrono interprets times as local-machine time. Subtract the tz offset so the
  // resulting absolute moment matches the user's wall-clock interpretation.
  const corrected = new Date(parsed.getTime() - offsetMs);
  return corrected.toISOString();
}

export function shortId(prefix = "r"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}
