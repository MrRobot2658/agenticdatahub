import { useEffect, useState, type JSX } from "react";
import {
  Database, RefreshCw, Layers, ChevronDown, Boxes,
} from "lucide-react";
import { getInfraStats, type InfraStats, type ObjectStat, type AppStat } from "../../api/platform";
import { useLang } from "../../context/LangContext";
import { useTenant } from "../../context/TenantContext";
import { useChatAction } from "../../context/ChatActionContext";

const POLL_MS = 8000;

// 明细名单（表名 / 流）。undefined=加载中，null=不可达，[]=暂无
export function NameList({ names }: { names: string[] | null | undefined }) {
  const { tr } = useLang();
  if (names === undefined) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>;
  if (names === null) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("服务暂不可达", "Service unreachable")}</div>;
  if (names.length === 0) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("暂无", "None")}</div>;
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {names.map((n) => (
        <div key={n} className="truncate rounded px-2 py-1 font-mono text-[11px] text-gray-600 hover:bg-gray-50" title={n}>{n}</div>
      ))}
    </div>
  );
}

// 业务对象记录数明细（label + count）
function ObjectCountList({ objects }: { objects: ObjectStat[] | undefined }) {
  const { tr } = useLang();
  if (objects === undefined) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>;
  if (objects.length === 0) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("暂无", "None")}</div>;
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {objects.map((o) => (
        <div key={o.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
          <span className="flex-1 truncate text-[12px] text-gray-600">{o.label}<span className="ml-1 font-mono text-[10px] text-gray-300">{o.key}</span></span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-900">{o.count === null ? "—" : o.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// 上/下游应用明细。点击某个应用 → 进入对话，让 agent 引导用户填信息完成接入。
export function AppList({ apps, kind }: { apps: AppStat[] | undefined; kind: "upstream" | "downstream" }) {
  const { tr } = useLang();
  const { ask } = useChatAction();
  if (apps === undefined) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>;
  if (apps.length === 0) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("暂无", "None")}</div>;
  const direction = kind === "upstream" ? "数据源（上游）" : "目的地（下游）";
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {apps.map((a) => (
        <button key={a.key} type="button"
          onClick={() => ask(`我想接入「${a.label}」作为${direction}。请一步步引导我完成接入：先说明需要准备哪些信息/凭证，再逐项询问我，待我提供后给出接入配置并确认接入。`)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-brand-50">
          <span className="flex-1 truncate text-[12px] text-gray-600">{a.label}</span>
          {a.configured > 0 ? (
            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">{tr("已接入", "Connected")} {a.configured}</span>
          ) : (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">{tr("去接入", "Connect")}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export default function TaskStatusPanel() {
  const { tr } = useLang();
  const { tenant } = useTenant();
  const [stats, setStats] = useState<InfraStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);   // 当前展开（单开手风琴）

  async function load() {
    setLoading(true);
    try { setStats(await getInfraStats(tenant)); } catch { /* ignore */ }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [tenant]);

  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

  // 数据源（只保留数据库）：业务库 · 数仓 · 对象（应用→应用 tab，Flink→实时链路 tab，队列/任务独立 tab）
  type InfraItem = { key: string; icon: JSX.Element; label: string; val: string; names?: string[] | null; objects?: ObjectStat[] };
  const items: InfraItem[] = [
    { key: "mysql", icon: <Database className="h-4 w-4 text-sky-600" />, label: tr("业务库表（MySQL）", "Business DB tables"), val: fmt(stats?.mysql_tables), names: stats?.mysql_table_names },
    { key: "doris", icon: <Layers className="h-4 w-4 text-violet-600" />, label: tr("数仓表（Doris）", "Doris tables"), val: fmt(stats?.doris_tables), names: stats?.doris_table_names },
    { key: "objects", icon: <Boxes className="h-4 w-4 text-rose-600" />, label: tr("对象", "Objects"), val: fmt(stats?.object_types), objects: stats?.objects },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-2">
        <Database className="h-4 w-4 text-brand-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{tr("数据源（数据库：业务库 / 数仓）", "Data Sources (Databases)")}</div>
          <div className="text-[11px] text-gray-400">{tr("点击数字查看详情", "Click a number for details")}</div>
        </div>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="space-y-1">
        {items.map((it) => {
          const expanded = open === it.key;
          return (
            <div key={it.key} className={`overflow-hidden rounded-lg border ${expanded ? "border-gray-200" : "border-gray-100"}`}>
              <button
                type="button"
                onClick={() => setOpen((o) => (o === it.key ? null : it.key))}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${expanded ? "bg-gray-50" : "bg-gray-50/60 hover:bg-gray-50"}`}
              >
                {it.icon}
                <span className="flex-1 truncate text-[12px] text-gray-600">{it.label}</span>
                <span className="text-[15px] font-bold tabular-nums text-gray-900">{it.val}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="border-t border-gray-100 bg-white px-2 py-1.5">
                  {it.key === "objects" ? (
                    <ObjectCountList objects={it.objects} />
                  ) : (
                    <NameList names={it.names} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
