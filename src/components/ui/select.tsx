import * as React from "react";
import { cn } from "@/lib/utils";
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cn("flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500", className)} {...props}>{children}</select>; }
