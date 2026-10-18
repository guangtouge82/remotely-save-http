/** Returns the replacement for Space + Enter at the end of a Markdown list item. */
export function childListLineAfterSpace(line: string, cursorCh: number): {
  fromCh: number;
  insertion: string;
} | null {
  if (cursorCh !== line.length) return null;

  const match = /^([ \t]*)([-+*]|\d+[.)])[ \t]+(.*\S)( +)$/.exec(line);
  if (!match) return null;

  const indent = match[1];
  const task = /^\[[^\]\r\n]\](?:[ \t]+(.*))?$/.exec(match[3]);
  if (task && !task[1]?.trim()) return null;
  const marker = /^\d/.test(match[2]) ? "1. " : `${match[2]} `;
  const fromCh = line.length - match[4].length;
  return {
    fromCh,
    insertion: `\n${indent}${" ".repeat(match[2].length + 1)}${marker}${task ? "[ ] " : ""}`,
  };
}
