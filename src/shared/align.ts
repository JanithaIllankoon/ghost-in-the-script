// Works out where in the script the speaker is, from the words the speech engine heard.
//
// The last few heard words are aligned against the script near the current position
// with a small local alignment (Smith-Waterman), which tolerates filler words,
// misheard words and skipped words. We only move on a confident match.

import type { Token } from "./markup";

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = same word, 0.6 = probably a mishearing, 0 = different. */
export function similarity(heard: string, script: string): number {
  if (heard === script) return 1;
  if (!heard || !script) return 0;
  const n = Math.min(heard.length, script.length);
  if (n >= 4 && lev(heard, script, 1) <= 1) return 0.75;
  if (n >= 7 && lev(heard, script, 2) <= 2) return 0.6;
  // "they're" vs "there", "two" vs "too"...
  if (n >= 3 && heard.slice(0, 3) === script.slice(0, 3) && Math.abs(heard.length - script.length) <= 2) return 0.4;
  return 0;
}

export interface AlignResult {
  /** Token index of the last matched script word. */
  index: number;
  matches: number;
  score: number;
}

function alignWindow(heard: string[], tokens: Token[], lo: number, hi: number): AlignResult | null {
  const m = heard.length;
  const n = hi - lo;
  if (m === 0 || n <= 0) return null;
  // H = score, C = number of matched words on the best path
  let H = new Float32Array(n + 1);
  let C = new Uint8Array(n + 1);
  let best: AlignResult | null = null;

  for (let i = 1; i <= m; i++) {
    const h = new Float32Array(n + 1);
    const c = new Uint8Array(n + 1);
    const word = heard[i - 1];
    for (let j = 1; j <= n; j++) {
      const sim = similarity(word, tokens[lo + j - 1].norm);
      const diag = H[j - 1] + (sim > 0 ? MATCH * sim : MISMATCH);
      const up = H[j] + GAP; // extra heard word ("um", ad-lib)
      const left = h[j - 1] + GAP; // skipped script word
      let v = 0;
      let cnt = 0;
      if (diag > v) { v = diag; cnt = C[j - 1] + (sim >= 0.6 ? 1 : 0); }
      if (up > v) { v = up; cnt = C[j]; }
      if (left > v) { v = left; cnt = c[j - 1]; }
      h[j] = v;
      c[j] = cnt;
      // Only count alignments that end on a matched word, and penalise trailing unmatched heard words.
      if (sim >= 0.6) {
        const s = v - (m - i) * 0.75;
        if (!best || s > best.score) best = { index: lo + j - 1, matches: cnt, score: s };
      }
    }
    H = h;
    C = c;
  }
  return best;
}

export class VoiceTracker {
  tokens: Token[] = [];
  /** Token index of the last word the speaker said (-1 = not started). */
  cursor = -1;
  private utterance: string[] = [];

  setTokens(tokens: Token[], keepWord?: number) {
    this.tokens = tokens;
    this.utterance = [];
    if (keepWord !== undefined) {
      const i = tokens.findIndex((t) => t.word >= keepWord);
      this.cursor = i < 0 ? tokens.length - 1 : i - 1;
    } else {
      this.cursor = -1;
    }
  }

  setCursorToWord(word: number) {
    const i = this.tokens.findIndex((t) => t.word >= word);
    this.cursor = i < 0 ? this.tokens.length - 1 : Math.max(-1, i - 1);
    this.utterance = [];
  }

  /** Feed the current phrase. Returns true if the position moved. */
  hear(text: string, isFinal: boolean): boolean {
    const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean);
    this.utterance = words;
    const moved = this.update();
    if (isFinal) this.utterance = [];
    return moved;
  }

  private update(): boolean {
    const tail = this.utterance.slice(-8);
    if (tail.length === 0 || this.tokens.length === 0) return false;

    const cur = this.cursor;
    const lo = Math.max(0, cur - 12);
    const hi = Math.min(this.tokens.length, cur + 1 + 45);
    const local = alignWindow(tail, this.tokens, lo, hi);

    const accept = (r: AlignResult | null): boolean => {
      if (!r) return false;
      const ahead = r.index - cur;
      if (ahead === 0) return false;
      if (ahead < 0) return r.matches >= 3 && ahead >= -12; // re-reading a line
      if (r.matches >= 2) return ahead <= 45;
      // A single word: only trust it if it's right next to us and not a tiny word.
      const tok = this.tokens[r.index];
      return r.matches === 1 && ahead <= 3 && tok.norm.length >= 4;
    };

    if (accept(local)) {
      this.cursor = local!.index;
      return true;
    }

    // Lost? Look through the whole script for a strong match (e.g. you jumped ahead).
    if (tail.length >= 4) {
      const global = alignWindow(tail, this.tokens, 0, this.tokens.length);
      if (global && global.matches >= 4 && Math.abs(global.index - cur) > 3) {
        this.cursor = global.index;
        return true;
      }
    }
    return false;
  }

  /** Visible word index the speaker is on (the last word said). */
  currentWord(): number {
    if (this.cursor < 0) return -1;
    return this.tokens[Math.min(this.cursor, this.tokens.length - 1)].word;
  }
}
