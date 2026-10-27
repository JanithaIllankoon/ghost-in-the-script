import JSZip from "jszip";

/** Reads .txt, .md and .docx files into script text. */
export async function importFile(file: File): Promise<{ title: string; body: string }> {
  const title = file.name.replace(/\.[^.]+$/, "");
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") return { title, body: await readDocx(file) };
  const text = await file.text();
  if (ext === "md" || ext === "markdown") return { title, body: fromMarkdown(text) };
  if (ext === "rtf") return { title, body: fromRtf(text) };
  return { title, body: text.replace(/\r\n?/g, "\n") };
}

function fromMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+(.*)$/gm, "**$1**")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/_([^_\n]+)_/g, "*$1*");
}

function fromRtf(rtf: string): string {
  // Good enough for plain RTF exported from Word/WordPad.
  return rtf
    .replace(/\\par[d]?/g, "\n")
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function on(rPr: Element | null, tag: string): boolean {
  const el = rPr?.getElementsByTagNameNS(W, tag)[0];
  if (!el) return false;
  const v = el.getAttributeNS(W, "val") ?? el.getAttribute("w:val");
  return !(v === "0" || v === "false" || v === "none");
}

async function readDocx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("This .docx file has no document text.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paras = Array.from(doc.getElementsByTagNameNS(W, "p"));
  const out: string[] = [];

  for (const p of paras) {
    let line = "";
    let cur = { b: false, i: false, u: false, hl: false };
    const open = (st: typeof cur) => {
      // close styles that end, open styles that start
      let s = "";
      if (cur.hl && !st.hl) s += "==";
      if (cur.u && !st.u) s += "__";
      if (cur.i && !st.i) s += "*";
      if (cur.b && !st.b) s += "**";
      if (!cur.b && st.b) s += "**";
      if (!cur.i && st.i) s += "*";
      if (!cur.u && st.u) s += "__";
      if (!cur.hl && st.hl) s += "==";
      cur = st;
      return s;
    };
    for (const r of Array.from(p.getElementsByTagNameNS(W, "r"))) {
      const rPr = r.getElementsByTagNameNS(W, "rPr")[0] ?? null;
      let text = "";
      for (const node of Array.from(r.childNodes)) {
        const el = node as Element;
        if (el.localName === "t") text += (el.textContent ?? "").replace(/\*/g, "\\*");
        else if (el.localName === "tab") text += " ";
        else if (el.localName === "br" || el.localName === "cr") text += "\n";
      }
      if (!text) continue;
      const st = { b: on(rPr, "b"), i: on(rPr, "i"), u: on(rPr, "u"), hl: !!rPr?.getElementsByTagNameNS(W, "highlight")[0] };
      line += open(st) + text;
    }
    line += open({ b: false, i: false, u: false, hl: false });
    out.push(line.trim());
  }
  return out.filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
