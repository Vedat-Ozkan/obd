import { readFileSync } from "node:fs";

const MIN_DP = 48;
const [density, ...files] = process.argv.slice(2);
if (density === undefined || files.length === 0 || Number.isNaN(Number(density))) throw new Error("usage: a11y-audit.ts <dpi from `adb shell wm density`> <uiautomator dump.xml>...");
const scale = Number(density) / 160;

interface Node { clickable: boolean; label: string; width: number; height: number; at: string; kids: Node[] }

function parse(xml: string): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const tag of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
    if (tag[1] === "/") { stack.pop(); continue; }
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag[2] ?? "")?.[1] ?? "";
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr("bounds")) ?? [];
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    const node: Node = { clickable: attr("clickable") === "true", label: (attr("text") + attr("content-desc")).trim(), width: (x2 ?? 0) - (x1 ?? 0), height: (y2 ?? 0) - (y1 ?? 0), at: attr("bounds"), kids: [] };
    (stack.at(-1)?.kids ?? roots).push(node);
    if (tag[3] !== "/") stack.push(node);
  }
  return roots;
}

const labelled = (node: Node): boolean => node.label !== "" || node.kids.some(labelled);
const all = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...all(n.kids)]);

let unchecked = false;
for (const file of files) {
  const nodes = all(parse(readFileSync(file, "utf8")));
  const clickable = nodes.filter((n) => n.clickable);
  console.log(`## ${file}`);
  if (nodes.length === 0 || clickable.length === 0) { console.log(`NOT CHECKED: ${nodes.length === 0 ? "no nodes" : "no clickable nodes"} in this dump`); unchecked = true; continue; }
  const small = clickable.filter((n) => n.width / scale < MIN_DP || n.height / scale < MIN_DP);
  const unlabelled = clickable.filter((n) => !labelled(n));
  console.log(`${String(clickable.length)} clickable nodes; ${String(small.length)} under ${String(MIN_DP)} dp; ${String(unlabelled.length)} with no text or content-desc (own or descendant)`);
  for (const n of small) console.log(`- SMALL ${(n.width / scale).toFixed(0)}x${(n.height / scale).toFixed(0)} dp at ${n.at}: ${n.label || "(no label)"}`);
  for (const n of unlabelled) console.log(`- UNLABELLED at ${n.at}`);
}
if (unchecked) process.exitCode = 2;
