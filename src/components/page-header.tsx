export function PageHeader({ title, description }: { title: string; description: string }) {
  return <div className="mb-8 max-w-3xl"><p className="mb-2 text-sm font-medium uppercase tracking-wide text-blue-700">Local-first study app</p><h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h1><p className="mt-3 text-slate-600">{description}</p></div>;
}
