"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
export function Tabs({ tabs, defaultValue }: { tabs: Array<{ value: string; label: string; content: React.ReactNode }>; defaultValue?: string }) {
  const [active, setActive] = React.useState(defaultValue ?? tabs[0]?.value);
  return <div className="space-y-4"><div className="flex flex-wrap gap-2 rounded-lg bg-slate-100 p-1">{tabs.map((tab) => <Button key={tab.value} type="button" variant={active === tab.value ? "default" : "ghost"} size="sm" onClick={() => setActive(tab.value)}>{tab.label}</Button>)}</div>{tabs.find((tab) => tab.value === active)?.content}</div>;
}
