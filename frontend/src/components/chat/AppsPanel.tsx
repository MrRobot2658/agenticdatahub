import { useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCw } from "lucide-react";
import { getInfraStats, type InfraStats } from "../../api/platform";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { AppList } from "./TaskStatusPanel";

const POLL_MS = 8000;

export default function AppsPanel() {
  const { tr } = useLang();
  const { tenant } = useTenant();
  const [stats, setStats] = useState<InfraStats | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setStats(await getInfraStats(tenant)); } catch { /* ignore */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [tenant]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{tr("应用（上下游接入）", "Apps (sources & destinations)")}</div>
          <div className="text-[11px] text-gray-400">{tr("点应用让助手引导你完成接入", "Click an app to start onboarding")}</div>
        </div>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
          <LogIn className="h-4 w-4 text-cyan-600" /> {tr("上游应用（数据源）", "Upstream")}
          <span className="ml-auto text-gray-400">{stats?.upstream_apps ?? "—"}</span>
        </div>
        <AppList apps={stats?.upstream} kind="upstream" />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-gray-600">
          <LogOut className="h-4 w-4 text-fuchsia-600" /> {tr("下游应用（目的地）", "Downstream")}
          <span className="ml-auto text-gray-400">{stats?.downstream_apps ?? "—"}</span>
        </div>
        <AppList apps={stats?.downstream} kind="downstream" />
      </div>
    </div>
  );
}
