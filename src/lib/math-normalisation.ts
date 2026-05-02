/**
 * Pre–study-pack math cleanup for PDF extraction artefacts (Monte Carlo / IS chapters).
 * Run on combined lecture text before block segmentation and item generation.
 */

import { normalizeGluedWords } from "@/lib/source-text-cleanup";

/** Removes C0 control characters except newline (LF) and tab (per project convention). */
function stripControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/**
 * Deterministic replacements for common PDF/math OCR issues before LaTeX conversion.
 * Chapter-agnostic rules first; profile-specific tuning happens in {@link normalizeExtractedMathText}.
 */
export function applyMathNormalisation(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = stripControls(t);
  t = normalizeGluedWords(t);

  t = t.replace(/\bselfnormalised\b/gi, "self-normalised").replace(/\bselfnormalized\b/gi, "self-normalized");

  t = t.replace(/\bunnormalised\b/gi, "unnormalised").replace(/\bunnormalized\b/gi, "unnormalized");

  t = t.replace(/ϕˆ\s*_?\s*N\s*_\s*\{?\s*MC\s*\}?/g, "\\hat{\\phi}^{N}_{\\mathrm{MC}}");
  t = t.replace(/ϕˆ\s*_?\s*N\s*_\s*\{?\s*IS\s*\}?/g, "\\hat{\\phi}^{N}_{\\mathrm{IS}}");
  t = t.replace(/ϕˆ\s*_?\s*N\s*_\s*\{?\s*SNIS\s*\}?/g, "\\hat{\\phi}^{N}_{\\mathrm{SNIS}}");
  t = t.replace(/\bϕˆ\s*_?\s*MC\b/g, "\\hat{\\phi}^{N}_{\\mathrm{MC}}");
  t = t.replace(/\bϕˆ\s*_?\s*IS\b/g, "\\hat{\\phi}^{N}_{\\mathrm{IS}}");
  t = t.replace(/\bϕˆ\s*_?\s*SNIS\b/g, "\\hat{\\phi}^{N}_{\\mathrm{SNIS}}");

  t = t.replace(/\bp\s*N\s*\?/g, "p_N^\\star");
  t = t.replace(/\bp\s+N\s*\?/g, "p_N^\\star");

  t = t.replace(/\bstdp\?/gi, "\\operatorname{std}_{p^\\star}");
  t = t.replace(/\bvarp\?/gi, "\\operatorname{Var}_{p^\\star}");

  t = t.replace(/\bESS\s*N\b(?!\s*=)/g, "ESS_N");
  t = t.replace(/\bESSN\b/g, "ESS_N");

  t = t.replace(/\bw¯\s*_?\s*i\b/g, "\\bar w_i");
  t = t.replace(/\bw¯i\b/g, "\\bar w_i");

  t = t.replace(/δ\s*X\s*_?\s*i\s*\(\s*dx\s*\)/gi, "\\delta_{X_i}(dx)");
  t = t.replace(/\bδXi\s*\(\s*dx\s*\)/gi, "\\delta_{X_i}(dx)");

  t = replaceIsolatedPQuestion(t);

  return t;
}

/** Replace standalone `p?` tokens when context suggests the target density p*. */
function replaceIsolatedPQuestion(source: string): string {
  return source.replace(/\bp\?(?!\w)/g, (match, offset, full) => {
    const window = `${full.slice(Math.max(0, offset - 80), offset)} ${full.slice(offset + match.length, Math.min(full.length, offset + match.length + 80))}`.toLowerCase();
    if (
      /\b(target|importance|proposal|sampling|density|unnormali|normalis|weight|marginal|likelihood|evidence|posterior|prior|snis|finite\s+var|support\s+condition|optimal\s+proposal|mixture|self[-\s]?normali|ess|ratio|bar\s*phi|phi\(x\))\b/.test(
        window,
      )
    )
      return "p^\\star";
    return match;
  });
}
