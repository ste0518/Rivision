"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [["Dashboard", "/dashboard"], ["Upload", "/upload"], ["Extract", "/extract"], ["Cards", "/cards"], ["Review", "/review"], ["Quiz", "/quiz"], ["Settings", "/settings"], ["Storage", "/settings/storage"]];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen"><header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><Link href="/dashboard" className="flex items-center gap-3 font-semibold text-slate-950"><span className="rounded-lg bg-blue-700 p-2 text-white"><BookOpenCheck size={20} /></span><span>Rivision</span></Link><nav className="flex flex-wrap gap-2 text-sm">{nav.map(([label, href]) => <Link key={href} href={href} className={cn("rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100", pathname === href && "bg-blue-50 text-blue-800")}>{label}</Link>)}</nav></div></header><main className="mx-auto max-w-7xl px-4 py-8">{children}</main></div>;
}
