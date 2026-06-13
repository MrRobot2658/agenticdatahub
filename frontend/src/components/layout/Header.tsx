import { ChevronDown, Search } from "lucide-react";
import { useTenant } from "../../context/TenantContext";

export default function Header() {
  const { tenant, setTenant, tenants } = useTenant();
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">搜索 Sources / Audiences / Profiles…</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <select
            value={tenant}
            onChange={(e) => setTenant(Number(e.target.value))}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-gray-700 focus:border-brand-400 focus:outline-none"
            title="Workspace（工作区 / 租户）"
          >
            {tenants.map((t) => (
              <option key={t} value={t}>Workspace · 租户 {t}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          A
        </div>
      </div>
    </header>
  );
}
