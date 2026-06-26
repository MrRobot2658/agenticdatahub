import { useEffect, useState } from "react";
import { X, Brain, Boxes, Plug, Gauge, Check, Database, Library, Radio, CalendarClock, Grid3x3, Activity } from "lucide-react";
import { getMcpTools, getAgents, type McpToolsResponse, type AgentDef } from "../../api/assistant";
import { getMemory, setMemory, getDisabledSkills, toggleSkill, getUsage, resetSessionUsage, type Usage } from "../../lib/prefs";
import { useLang } from "../../context/LangContext";
import TaskStatusPanel from "./TaskStatusPanel";
import KnowledgePanel from "./KnowledgePanel";
import QueuePanel from "./QueuePanel";
import TasksPanel from "./TasksPanel";
import AppsPanel from "./AppsPanel";
import PipelinePanel from "./PipelinePanel";

type Tab = "data" | "apps" | "pipeline" | "queue" | "tasks" | "kb" | "memory" | "skills" | "mcp" | "usage";

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tr } = useLang();
  const [tab, setTab] = useState<Tab>("data");

  // 记忆
  const [memory, setMem] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  // 技能
  const [agents, setAgents] = useState<AgentDef[] | null>(null);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  // MCP
  const [mcp, setMcp] = useState<McpToolsResponse | null>(null);
  // 用量
  const [usage, setUsage] = useState<Usage>({ session: 0, total: 0 });

  useEffect(() => {
    if (!open) return;
    setMem(getMemory());
    setDisabled(getDisabledSkills());
    setUsage(getUsage());
    getAgents().then(setAgents).catch(() => setAgents([]));
    getMcpTools().then(setMcp).catch(() => setMcp({ server: { name: "-", transport: "-", path: "-" }, tools: [], error: "unreachable" }));
  }, [open]);

  if (!open) return null;

  function saveMemory() {
    setMemory(memory);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }
  function onToggleSkill(key: string) {
    const enabled = disabled.has(key);   // 当前禁用 → 切为启用
    toggleSkill(key, enabled);
    setDisabled(getDisabledSkills());
  }

  const tabs: { key: Tab; label: string; icon: typeof Brain }[] = [
    { key: "data", label: tr("数据源", "Data sources"), icon: Database },
    { key: "apps", label: tr("应用", "Apps"), icon: Grid3x3 },
    { key: "pipeline", label: tr("实时链路", "Pipeline"), icon: Activity },
    { key: "queue", label: tr("队列", "Queues"), icon: Radio },
    { key: "tasks", label: tr("任务", "Tasks"), icon: CalendarClock },
    { key: "kb", label: tr("知识库", "Knowledge"), icon: Library },
    { key: "memory", label: tr("记忆", "Memory"), icon: Brain },
    { key: "skills", label: tr("技能", "Skills"), icon: Boxes },
    { key: "mcp", label: tr("MCP", "MCP"), icon: Plug },
    { key: "usage", label: tr("Token 消耗", "Token usage"), icon: Gauge },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative flex h-[560px] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 侧栏 tabs */}
        <div className="flex w-44 shrink-0 flex-col border-r border-gray-100 bg-gray-50/70 p-3">
          <div className="px-2 pb-2 text-sm font-bold text-gray-900">{tr("设置", "Settings")}</div>
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium ${tab === t.key ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">{tabs.find((t) => t.key === tab)?.label}</span>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === "data" && <TaskStatusPanel />}
            {tab === "apps" && <AppsPanel />}
            {tab === "pipeline" && <PipelinePanel />}
            {tab === "queue" && <QueuePanel />}
            {tab === "tasks" && <TasksPanel />}
            {tab === "kb" && <KnowledgePanel />}

            {tab === "memory" && (
              <div className="space-y-3">
                <p className="text-[12px] text-gray-500">{tr("长期记忆会作为系统上下文注入每次对话（如：偏好、口径、常用租户）。", "Long-term memory is injected as system context into every chat (preferences, definitions, default tenant…).")}</p>
                <textarea value={memory} onChange={(e) => setMem(e.target.value)} rows={10}
                  placeholder={tr("例如：默认看租户 1001；GMV 只算已支付订单；回答用中文。", "e.g. default to tenant 1001; GMV counts paid orders only; answer in Chinese.")}
                  className="w-full resize-none rounded-xl border border-gray-200 p-3 text-[13px] focus:border-brand-400 focus:outline-none" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={saveMemory} className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-brand-600">{tr("保存记忆", "Save")}</button>
                  {savedFlash && <span className="inline-flex items-center gap-1 text-[12px] text-emerald-600"><Check className="h-3.5 w-3.5" /> {tr("已保存", "Saved")}</span>}
                </div>
              </div>
            )}

            {tab === "skills" && (
              <div className="space-y-2">
                <p className="text-[12px] text-gray-500">{tr("智能体技能（子代理）。关闭后该会话不再调度对应技能。", "Agent skills (sub-agents). Disabling stops scheduling that skill.")}</p>
                {agents === null && <div className="py-6 text-center text-[12px] text-gray-400">{tr("加载中…", "Loading…")}</div>}
                {agents?.map((a) => {
                  const on = !disabled.has(a.key);
                  return (
                    <div key={a.key} className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-gray-900">{a.name}</div>
                        <div className="truncate text-[12px] text-gray-500" title={a.desc}>{a.desc}</div>
                      </div>
                      <button type="button" onClick={() => onToggleSkill(a.key)}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-brand-500" : "bg-gray-300"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "mcp" && (
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-[12px]">
                  <div className="flex justify-between"><span className="text-gray-500">{tr("服务", "Server")}</span><span className="font-mono text-gray-800">{mcp?.server.name ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">{tr("传输", "Transport")}</span><span className="font-mono text-gray-800">{mcp?.server.transport ?? "—"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-500">{tr("路径", "Path")}</span><span className="truncate font-mono text-gray-800" title={mcp?.server.path}>{mcp?.server.path ?? "—"}</span></div>
                </div>
                <div className="text-[12px] font-semibold text-gray-700">{tr("可用工具", "Tools")} <span className="text-gray-400">({mcp?.tools.length ?? 0})</span></div>
                {mcp?.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{tr("MCP 不可达", "MCP unreachable")}: {mcp.error}</div>}
                <div className="space-y-1.5">
                  {mcp?.tools.map((t) => (
                    <div key={t.name} className="rounded-lg border border-gray-100 px-3 py-2">
                      <div className="font-mono text-[12px] font-semibold text-brand-700">{t.name}</div>
                      <div className="text-[12px] text-gray-500">{t.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "usage" && (
              <div className="space-y-3">
                <p className="text-[12px] text-gray-500">{tr("客户端估算（按字符数），非计费口径，仅供参考。", "Client-side estimate (by characters), not billing-grade — indicative only.")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold tabular-nums text-gray-900">{usage.session.toLocaleString()}</div>
                    <div className="mt-1 text-[12px] text-gray-500">{tr("本会话 Tokens", "This session")}</div>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-4 text-center">
                    <div className="text-2xl font-bold tabular-nums text-gray-900">{usage.total.toLocaleString()}</div>
                    <div className="mt-1 text-[12px] text-gray-500">{tr("累计 Tokens", "All-time")}</div>
                  </div>
                </div>
                <button type="button" onClick={() => { resetSessionUsage(); setUsage(getUsage()); }}
                  className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-50">{tr("重置本会话计数", "Reset session counter")}</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
