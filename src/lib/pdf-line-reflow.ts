/**
 * Inserts newlines before common academic heading patterns when PDF text
 * is glued into very long lines — restores signals for {@link heading-detection}.
 */

const LONG_LINE = 200;

export function reflowPrintedTextForHeadingDetection(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n");
  const lines = t.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.length < LONG_LINE) {
      out.push(line);
      continue;
    }
    let s = line;
    s = s.replace(/([.!?]["'”]?\s+)(Chapter\s+\d)/gi, "$1\n$2");
    s = s.replace(/([.!?]["'”]?\s+)(\d{1,2}\.\d{1,3}\s+[A-Z\u00C0-\u024F])/g, "$1\n$2");
    s = s.replace(
      /([a-z0-9%)\]}])(\s+)((?:Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Exercise|Algorithm)\s+\d)/gi,
      "$1\n$3",
    );
    s = s.replace(/([a-z0-9%)\]}])(\s+)(Proof\s*[.:])/gi, "$1\n$3");
    out.push(s);
  }
  return out.join("\n");
}
