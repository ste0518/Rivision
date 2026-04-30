import * as React from "react";
import { cn } from "@/lib/utils";
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) { return <input type={type} className={cn("flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500", className)} {...props} />; }
