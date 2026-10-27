// Script formatting:
//   **bold**   *italic*   __underline__   ==highlight==
//   [cue or note]   -> shown in the cue colour, never read by voice tracking
//   {red}coloured text{/}   (any CSS colour name or #hex)
//   blank line = new paragraph, single line break = new line
//   \*  -> a literal asterisk

import { numberToWords } from "./numbers";

export interface Token {
  /** Comparison form: lowercase letters/digits only. */
  norm: string;
  /** Form sent to the speech engine's vocabulary (keeps apostrophes). */
  vocab: string;
  /** Index into `words` (the visible word element this token belongs to). */
  word: number;
}

export interface RenderedScript {
  words: HTMLElement[];
  tokens: Token[];
  vocabulary: string[];
  wordCount: number;
}

const MARKER = /(\*\*|\*|__|==|\{\/\}|\{[#a-zA-Z0-9]+\}|\[[^\]\n]*\]|\n)/;
const ESC_STAR = "";

export function normalizeWord(raw: string): { norm: string; vocab: string }[] {
  let w = raw.toLowerCase().replace(/[‘’ʼ]/g, "'");
  w = w.replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/@/g, " at ");
  const out: { norm: string; vocab: string }[] = [];
  for (let part of w.split(/[\s\-\u2013\u2014/]+/)) {
    const dollars = part.includes("$");
    const percent = part.includes("%");
    part = part.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!part) continue;
    const num = part.replace(/,/g, "");
    if (/^\d+(\.\d+)?$/.test(num)) {
      const [int, dec] = num.split(".");
      const words = numberToWords(parseInt(int, 10));
      if (dec) words.push("point", ...dec.split("").flatMap((d) => numberToWords(+d)));
      if (percent) words.push("percent");
      if (dollars) words.push("dollars");
      for (const x of words) out.push({ norm: x, vocab: x });
      continue;
    }
    const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(part);
    if (ordinal) {
      for (const x of numberToWords(+ordinal[1])) out.push({ norm: x, vocab: x });
      continue;
    }
    const vocab = part.replace(/[^a-z0-9']/g, "");
    const norm = vocab.replace(/'/g, "");
    if (norm) out.push({ norm, vocab });
  }
  return out;
}

interface Style {
  b: boolean;
  i: boolean;
  u: boolean;
  hl: boolean;
  colors: string[];
}

function applyStyle(el: HTMLElement, st: Style) {
  if (st.b) el.classList.add("b");
  if (st.i) el.classList.add("i");
  if (st.u) el.classList.add("u");
  if (st.hl) el.classList.add("hl");
  if (st.colors.length) el.style.color = st.colors[st.colors.length - 1];
}

function styled(st: Style) {
  return st.b || st.i || st.u || st.hl || st.colors.length > 0;
}

/** Renders the script into `container` and returns the words for scrolling and voice tracking. */
export function renderScript(body: string, container: HTMLElement): RenderedScript {
  container.textContent = "";
  const words: HTMLElement[] = [];
  const tokens: Token[] = [];
  const vocab = new Set<string>();

  const text = body.replace(/\r\n?/g, "\n").replace(/\\\*/g, ESC_STAR).trim();
  const paragraphs = text ? text.split(/\n[ \t]*\n+/) : [];

  for (const para of paragraphs) {
    const p = document.createElement("p");
    p.className = "para";
    const st: Style = { b: false, i: false, u: false, hl: false, colors: [] };

    for (const piece of para.split(MARKER)) {
      if (!piece) continue;
      if (piece === "**") { st.b = !st.b; continue; }
      if (piece === "*") { st.i = !st.i; continue; }
      if (piece === "__") { st.u = !st.u; continue; }
      if (piece === "==") { st.hl = !st.hl; continue; }
      if (piece === "{/}") { st.colors.pop(); continue; }
      if (piece === "\n") { p.appendChild(document.createElement("br")); continue; }
      if (piece.startsWith("{") && piece.endsWith("}")) {
        const c = piece.slice(1, -1);
        if (CSS.supports("color", c)) { st.colors.push(c); continue; }
      }
      if (piece.startsWith("[") && piece.endsWith("]")) {
        const cue = document.createElement("span");
        cue.className = "cue";
        cue.textContent = piece.replace(new RegExp(ESC_STAR, "g"), "*");
        p.appendChild(cue);
        continue;
      }

      const chunk = piece.replace(new RegExp(ESC_STAR, "g"), "*");
      for (const part of chunk.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (styled(st)) {
            const s = document.createElement("span");
            applyStyle(s, st);
            s.textContent = part;
            p.appendChild(s);
          } else {
            p.appendChild(document.createTextNode(part));
          }
          continue;
        }
        const span = document.createElement("span");
        span.className = "w";
        applyStyle(span, st);
        span.textContent = part;
        const index = words.length;
        span.dataset.i = String(index);
        words.push(span);
        p.appendChild(span);
        for (const t of normalizeWord(part)) {
          tokens.push({ ...t, word: index });
          vocab.add(t.vocab);
          if (t.vocab.endsWith("'s")) vocab.add(t.vocab.slice(0, -2));
          if (t.vocab !== t.norm) vocab.add(t.norm);
        }
      }
    }
    container.appendChild(p);
  }

  return { words, tokens, vocabulary: [...vocab], wordCount: words.length };
}

/** Plain-text stats without touching the DOM (used by the editor). */
export function countWords(body: string): number {
  const clean = body.replace(/\[[^\]\n]*\]/g, " ").replace(/\{[^}\s]*\}|\*\*|==|__|\*/g, "");
  const m = clean.match(/\S+/g);
  return m ? m.length : 0;
}
