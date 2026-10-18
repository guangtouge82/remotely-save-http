export interface ListSubtree {
  firstLine: number;
  lastLine: number;
}

const listPrefix = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/;
const headingPrefix = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;

function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Finds a list item and its indented descendants without changing Markdown. */
export function findListSubtree(
  lineCount: number,
  getLine: (line: number) => string,
  firstLine: number
): ListSubtree | null {
  if (firstLine < 0 || firstLine >= lineCount) return null;
  const first = getLine(firstLine);
  if (!listPrefix.test(first)) return null;
  const baseIndent = indentWidth(first);
  let lastLine = firstLine;
  for (let line = firstLine + 1; line < lineCount; line++) {
    const text = getLine(line);
    if (text.trim() === "") continue;
    if (indentWidth(text) <= baseIndent) break;
    lastLine = line;
  }
  return { firstLine, lastLine };
}

/** Focuses a list item or a Markdown heading with its section content. */
export function findNarrowRange(
  lineCount: number,
  getLine: (line: number) => string,
  firstLine: number
): ListSubtree | null {
  if (firstLine < 0 || firstLine >= lineCount) return null;
  const heading = headingPrefix.exec(getLine(firstLine));
  if (!heading) return findListSubtree(lineCount, getLine, firstLine);

  const level = heading[1].length;
  let lastLine = firstLine;
  for (let line = firstLine + 1; line < lineCount; line++) {
    const next = headingPrefix.exec(getLine(line));
    if (next && next[1].length <= level) break;
    if (getLine(line).trim() !== "") lastLine = line;
  }
  return { firstLine, lastLine };
}
