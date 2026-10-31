// Script formatting:
//   **bold**   *italic*   __underline__   ==highlight==
//   [cue or note]   -> shown in the cue colour, never read by voice tracking
//   {red}coloured text{/}   (any CSS colour name or #hex)
//   blank line = new paragraph, single line break = new line
//   \*  \_  \=  \[  \{  -> the character itself, not a mark
//
// Marks pair up within a paragraph, like Markdown: a mark with no partner shows as typed,
// and extra marks in a run show as text (****Bold**** is **Bold** in bold).

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

type Kind = "b" | "i" | "u" | "hl";

/** One piece of a paragraph after the formatting marks are worked out. */
export type Segment =
  | { type: "text"; text: string; b: boolean; i: boolean; u: boolean; hl: boolean; color: string | null }
  | { type: "cue"; text: string }
  | { type: "br" };
type TextSegment = Extract<Segment, { type: "text" }>;

/** Characters that a backslash turns into plain text: \* \_ \= \[ \] \{ \} \\ */
const ESCAPABLE = "*_=[]{}\\";
/** Escaped characters are swapped for private-use characters while parsing, then put back. */
const ESC_BASE = 0xe000;
const escapeChars = (s: string) => s.replace(/\\([*_={}[\]\\])/g, (_, c: string) => String.fromCharCode(ESC_BASE + ESCAPABLE.indexOf(c)));
const unescapeChars = (s: string) => s.replace(/[-]/g, (c) => ESCAPABLE[c.charCodeAt(0) - ESC_BASE]);

// A cue is [note]. Doubled or nested brackets stay part of it: [[TRY IT]] and [see [this]] are one cue each.
const MARKER = /(\*+|_{2,}|={2,}|\{\/\}|\{[#a-zA-Z0-9]+\}|\[+(?:[^[\]\n]|\[[^[\]\n]*\])*\]+|\n)/;
const MARK_TEXT: Record<Kind, string> = { b: "**", i: "*", u: "__", hl: "==" };
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** A run of *, _ or = characters, and what it ended up doing. */
interface Run {
  char: string;
  /** Marks the run can stand for, outermost first. */
  kinds: Kind[];
  /** Characters beyond the marks, shown as typed (inside the marks): ****Bold**** shows **Bold** in bold. */
  extra: number;
  canOpen: boolean;
  canClose: boolean;
  role: "open" | "close" | "text";
  /** Marks that found a partner (the rest show as typed). */
  active: Set<Kind>;
}

type Piece =
  | { t: "text"; s: string }
  | { t: "cue"; s: string }
  | { t: "br" }
  | { t: "color"; c: string }
  | { t: "colorEnd" }
  | { t: "run"; run: Run };

function makeRun(char: string, n: number, prev: string | undefined, next: string | undefined): Run {
  let kinds: Kind[];
  let extra: number;
  if (char === "*") {
    kinds = n === 1 ? ["i"] : n === 3 ? ["b", "i"] : ["b"];
    extra = n > 3 ? n - 2 : 0;
  } else {
    kinds = [char === "_" ? "u" : "hl"];
    extra = n - 2;
  }
  // Like Markdown: a mark opens when text follows it, and closes when text comes right before it.
  let canOpen = !isSpace(next);
  let canClose = !isSpace(prev);
  // Underscores inside a word (snake__case) are just text.
  if (char === "_") {
    canOpen &&= !isWordChar(prev);
    canClose &&= !isWordChar(next);
  }
  return { char, kinds, extra, canOpen, canClose, role: "text", active: new Set() };
}

/** Splits one paragraph into text, cues and line breaks, pairing up the formatting marks. */
function parseParagraph(para: string, isColor: (c: string) => boolean): Segment[] {
  // 1. Split into pieces, noting what's either side of each run of marks.
  const pieces: Piece[] = [];
  let pos = 0;
  for (const piece of para.split(MARKER)) {
    const start = pos;
    pos += piece.length;
    if (!piece) continue;
    const c = piece[0];
    if (piece === "\n") pieces.push({ t: "br" });
    else if (/^(\*+|_{2,}|={2,})$/.test(piece)) pieces.push({ t: "run", run: makeRun(c, piece.length, para[start - 1], para[pos]) });
    else if (piece === "{/}") pieces.push({ t: "colorEnd" });
    else if (c === "{" && piece.endsWith("}") && isColor(piece.slice(1, -1))) pieces.push({ t: "color", c: piece.slice(1, -1) });
    else if (c === "[" && piece.endsWith("]")) pieces.push({ t: "cue", s: piece });
    else pieces.push({ t: "text", s: piece });
  }

  // 2. Pair openers with closers of the same kind. Anything left unpaired shows as typed.
  const open: Record<Kind, Run[]> = { b: [], i: [], u: [], hl: [] };
  for (const p of pieces) {
    if (p.t !== "run") continue;
    const run = p.run;
    const closable = run.canClose ? run.kinds.filter((k) => open[k].length > 0) : [];
    if (closable.length) {
      run.role = "close";
      for (const k of closable) {
        open[k].pop()!.active.add(k);
        run.active.add(k);
      }
    } else if (run.canOpen) {
      run.role = "open";
      for (const k of run.kinds) open[k].push(run);
    }
  }

  // 3. Walk the pieces, turning styles on and off and collecting text.
  const out: Segment[] = [];
  const st = { b: false, i: false, u: false, hl: false, colors: [] as string[] };
  const text = (s: string) => {
    if (!s) return;
    const seg: TextSegment = { type: "text", text: s, b: st.b, i: st.i, u: st.u, hl: st.hl, color: st.colors.at(-1) ?? null };
    const last = out.at(-1);
    // Join with the previous piece when the style matches, so "**" + "Bold" stays one word.
    if (last?.type === "text" && last.b === seg.b && last.i === seg.i && last.u === seg.u && last.hl === seg.hl && last.color === seg.color) {
      last.text += s;
    } else {
      out.push(seg);
    }
  };
  for (const p of pieces) {
    if (p.t === "text") text(unescapeChars(p.s));
    else if (p.t === "br") out.push({ type: "br" });
    else if (p.t === "cue") out.push({ type: "cue", text: unescapeChars(p.s) });
    else if (p.t === "color") st.colors.push(p.c);
    else if (p.t === "colorEnd") {
      if (st.colors.length) st.colors.pop();
      else text("{/}");
    } else {
      const run = p.run;
      const extra = run.char.repeat(run.extra);
      const unused = run.kinds.filter((k) => !run.active.has(k)).map((k) => MARK_TEXT[k]).join("");
      if (run.role === "open" && run.active.size) {
        text(unused);
        for (const k of run.kinds) if (run.active.has(k)) st[k] = true;
        text(extra);
      } else if (run.role === "close") {
        text(extra);
        for (const k of run.kinds) if (run.active.has(k)) st[k] = false;
        text(unused);
      } else {
        text(run.kinds.map((k) => MARK_TEXT[k]).join("") + extra);
      }
    }
  }
  return out;
}

const cssColor = (c: string) => typeof CSS !== "undefined" && CSS.supports("color", c);

/** The script as paragraphs of segments, with the formatting marks worked out. */
export function parseScript(body: string, isColor: (c: string) => boolean = cssColor): Segment[][] {
  const text = escapeChars(body.replace(/\r\n?/g, "\n")).trim();
  if (!text) return [];
  return text.split(/\n[ \t]*\n+/).map((para) => parseParagraph(para, isColor));
}

function applyStyle(el: HTMLElement, seg: TextSegment) {
  if (seg.b) el.classList.add("b");
  if (seg.i) el.classList.add("i");
  if (seg.u) el.classList.add("u");
  if (seg.hl) el.classList.add("hl");
  if (seg.color) el.style.color = seg.color;
}

/** Renders the script into `container` and returns the words for scrolling and voice tracking. */
export function renderScript(body: string, container: HTMLElement): RenderedScript {
  container.textContent = "";
  const words: HTMLElement[] = [];
  const tokens: Token[] = [];
  const vocab = new Set<string>();

  for (const para of parseScript(body)) {
    const p = document.createElement("p");
    p.className = "para";

    for (const seg of para) {
      if (seg.type === "br") {
        p.appendChild(document.createElement("br"));
        continue;
      }
      if (seg.type === "cue") {
        const cue = document.createElement("span");
        cue.className = "cue";
        cue.textContent = seg.text;
        p.appendChild(cue);
        continue;
      }
      const styled = seg.b || seg.i || seg.u || seg.hl || !!seg.color;
      for (const part of seg.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (styled) {
            const s = document.createElement("span");
            applyStyle(s, seg);
            s.textContent = part;
            p.appendChild(s);
          } else {
            p.appendChild(document.createTextNode(part));
          }
          continue;
        }
        const span = document.createElement("span");
        span.className = "w";
        applyStyle(span, seg);
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
  let n = 0;
  for (const para of parseScript(body)) {
    const text = para.map((s) => (s.type === "text" ? s.text : " ")).join("");
    n += text.match(/\S+/g)?.length ?? 0;
  }
  return n;
}
