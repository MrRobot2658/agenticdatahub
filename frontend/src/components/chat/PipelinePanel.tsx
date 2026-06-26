import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { getInfraStats, type InfraStats } from "../../api/platform";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { NameList } from "./TaskStatusPanel";

const POLL_MS = 8000;

export default function PipelinePanel() {
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-emerald-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{tr("实时链路（Flink 计算）", "Real-time pipeline (Flink)")}</div>
          <div className="text-[11px] text-gray-400">{tr("流式 ID-Mapping / 画像聚合 / 宽表打宽", "Streaming ID-Mapping / profile / wide-table")}</div>
        </div>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
          {stats?.flink_jobs ?? "—"} {tr("任务", "jobs")}
        </span>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <NameList names={stats?.flink_streams} />
    </div>
  );
}
