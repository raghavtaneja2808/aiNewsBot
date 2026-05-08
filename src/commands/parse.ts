export type ParsedCommand = {
  name: string;     // lowercased, no slash
  rest: string;     // everything after the command name, untrimmed-tail trimmed
  args: string[];   // whitespace-split rest
};

export function parseCommand(text: string): ParsedCommand | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const space = t.indexOf(" ");
  const name = (space === -1 ? t.slice(1) : t.slice(1, space)).toLowerCase();
  if (!name) return null;
  const rest = space === -1 ? "" : t.slice(space + 1).trim();
  const args = rest.length ? rest.split(/\s+/) : [];
  return { name, rest, args };
}
