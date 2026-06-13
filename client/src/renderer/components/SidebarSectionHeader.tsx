export function SidebarSectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-xs uppercase tracking-wider text-slate-500">
      {label}
    </div>
  );
}
