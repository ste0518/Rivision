"use client";

import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function MathMarkdown({ content, className }: { content?: string; className?: string }) {
  const safeContent = typeof content === "string" ? content : "";
  return (
    <div className={cn("math-text rounded-lg bg-slate-50 p-4 text-sm text-slate-800", className)}>
      <MathRenderBoundary content={safeContent}>
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {normaliseMathDelimiters(safeContent)}
        </ReactMarkdown>
      </MathRenderBoundary>
    </div>
  );
}

class MathRenderBoundary extends Component<{ content: string; children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "Math rendering failed." };
  }

  componentDidUpdate(previous: { content: string }) {
    if (previous.content !== this.props.content && this.state.error) this.setState({ error: undefined });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="space-y-2">
          <Badge variant="unknown">Math render warning</Badge>
          <p className="whitespace-pre-wrap">{this.props.content}</p>
          <p className="text-xs text-amber-700">{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function normaliseMathDelimiters(value: string) {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n$$\n${math.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
}
