import { isPossiblePersonName } from "./name-detection";

interface TextItem {
  str?: string;
  transform?: number[];
  height?: number;
  width?: number;
  hasEOL?: boolean;
}
interface Segment {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

// PDF object order is not necessarily reading order. Reconstruct horizontal
// lines from geometry, preserving word fragments and separating wide columns.
export function readPdfPage(items: TextItem[]) {
  const segments: Segment[] = items
    .filter((item) => item.str?.trim() && item.transform?.length === 6)
    .map((item) => ({
      text: item.str!.replace(/\s+/g, " "),
      x: item.transform![4],
      y: item.transform![5],
      width: item.width || 0,
      size: Math.abs(
        item.height || Math.hypot(item.transform![2], item.transform![3]) || 12,
      ),
    }))
    .filter((item) =>
      [item.x, item.y, item.width, item.size].every(Number.isFinite),
    )
    .sort((a, b) => b.y - a.y || a.x - b.x);
  if (!segments.length)
    return {
      text: items
        .map((item) => (item.str || "") + (item.hasEOL ? "\n" : " "))
        .join(""),
      nameHints: [],
    };
  const rows: Segment[][] = [];
  for (const item of segments) {
    const last = rows.at(-1);
    if (
      last &&
      Math.abs(last[0].y - item.y) <= Math.min(last[0].size, item.size) * 0.3
    )
      last.push(item);
    else rows.push([item]);
  }
  const lines: Segment[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = { ...row[0] };
    for (const item of row.slice(1)) {
      const gap = item.x - (line.x + line.width);
      if (
        gap > Math.max(line.size, item.size) * 4 ||
        (gap > Math.min(line.size, item.size) * 0.5 &&
          (item.text.includes("@") || line.text.includes("@")))
      ) {
        lines.push(line);
        line = { ...item };
      } else {
        // Adjacent glyph fragments are joined, while actual word gaps retain spaces.
        line.text +=
          (gap > Math.min(line.size, item.size) * 0.12 ? " " : "") + item.text;
        line.width = Math.max(line.width, item.x + item.width - line.x);
        line.size = Math.max(line.size, item.size);
      }
    }
    lines.push(line);
  }
  for (const line of lines) line.text = line.text.replace(/\s+/g, " ").trim();
  const sizes = lines.map((line) => line.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)];
  const top = lines
    .slice(0, 10)
    .filter((line) => segments[0].y - line.y <= 160);
  const prominent = top.filter(
    (line) => line.size >= bodySize * 1.2 && isPossiblePersonName(line.text),
  );
  const largest = Math.max(...prominent.map((line) => line.size));
  return {
    text: lines.map((line) => line.text).join("\n"),
    nameHints: prominent
      .filter((line) => Math.abs(line.size - largest) < 0.5)
      .map((line) => line.text),
  };
}
