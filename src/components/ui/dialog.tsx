"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return <dialog ref={ref} onClose={() => onOpenChange(false)} className="rounded-xl p-0 backdrop:bg-slate-950/40">{children}</dialog>;
}
export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("max-h-[90vh] w-[min(92vw,760px)] overflow-auto bg-white p-6", className)} {...props} />; }
