"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

export function MathText({ children, className }: { children?: string; className?: string }) {
  const content = normaliseMathDelimiters(children || "");

  return (
    <div className={cn("math-text rounded-lg bg-slate-50 p-4 text-sm text-slate-800", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function normaliseMathDelimiters(value: string) {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
}
