import * as React from "react";
import { cn } from "@/lib/utils";
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) { return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />; }
export const TableHeader = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />;
export const TableBody = (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />;
export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) { return <tr className={cn("border-b border-slate-200", className)} {...props} />; }
export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) { return <th className={cn("h-10 px-3 text-left align-middle font-medium text-slate-500", className)} {...props} />; }
export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) { return <td className={cn("p-3 align-middle", className)} {...props} />; }
