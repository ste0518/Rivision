import * as React from "react";
import { cn } from "@/lib/utils";
const variants = { default: "bg-slate-900 text-white", must_know: "bg-blue-100 text-blue-800", partial: "bg-amber-100 text-amber-800", not_required: "bg-slate-200 text-slate-700", unknown: "bg-red-100 text-red-800", outline: "border border-slate-300 text-slate-700" };
export function Badge({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) { return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", variants[variant], className)} {...props} />; }
