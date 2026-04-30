import { MathMarkdown } from "@/components/MathMarkdown";

export function MathText({ children, className }: { children?: string; className?: string }) {
  return <MathMarkdown content={children} className={className} />;
}
