export function MathText({ children }: { children: string }) {
  // TODO: Render LaTeX with KaTeX or MathJax. MVP preserves raw notation exactly.
  return <div className="math-text rounded-lg bg-slate-50 p-4 text-sm text-slate-800">{children}</div>;
}
