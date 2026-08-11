import { KINDS, type Kind } from "../entry.js";

/**
 * The comment-command grammar: deterministic, parsed not interpreted.
 * Field writes land verbatim; there is no "ask the model to rewrite this" command,
 * which would hand a privileged write channel to any commenter.
 */
export type Command =
  | { type: "set-kind"; value: Kind }
  | { type: "set-summary"; value: string }
  | { type: "set-notes"; value: string }
  | { type: "pin" }
  | { type: "reclassify" }
  | { type: "invalid"; reason: string };

const PREFIX = "/onegai";

/** Parse a comment body into a command, or null when it is not a command. */
export function parseCommand(body: string): Command | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (!first.startsWith(PREFIX)) return null;

  const rest = first.slice(PREFIX.length).trim();
  if (rest.length === 0) return { type: "invalid", reason: "no command given" };

  if (rest === "pin") return { type: "pin" };
  if (rest === "reclassify") return { type: "reclassify" };

  const fieldMatch = rest.match(/^(?<field>kind|summary|notes):\s?(?<value>.*)$/);
  if (!fieldMatch?.groups) {
    return { type: "invalid", reason: `unknown command: ${rest}` };
  }

  const { field, value } = fieldMatch.groups as { field: string; value: string };

  if (field === "kind") {
    const kind = value.trim();
    if (!(KINDS as readonly string[]).includes(kind)) {
      return { type: "invalid", reason: `not a valid kind: ${kind}` };
    }
    return { type: "set-kind", value: kind as Kind };
  }

  if (field === "summary") {
    return { type: "set-summary", value: value.trim() };
  }

  // notes takes the remainder of the comment body after the command line.
  const remainder = lines.slice(1).join("\n").trim();
  const combined = [value.trim(), remainder].filter((s) => s.length > 0).join("\n");
  return { type: "set-notes", value: combined };
}
