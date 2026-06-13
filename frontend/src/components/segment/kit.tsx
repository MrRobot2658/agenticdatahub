import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Card } from "../ui";

/** 「Mock 数据」标记 —— 诚实标注未接后端的占位页。 */
export function MockTag({ children = "Mock 数据" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
      {children}
    </span>
  );
}

type Tone = "green" | "amber" | "red" | "gray" | "brand" | "blue";
const TONE: Record<Tone, string> = {
  green: "bg-brand-50 text-brand-700 ring-brand-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  gray: "bg-gray-100 text-gray-600 ring-gray-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function StatusPill({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "green" || tone === "brand" ? "bg-brand-500" : tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-red-500" : tone === "blue" ? "bg-blue-500" : "bg-gray-400"}`} />
      {children}
    </span>
  );
}

/** 顶部统计行 */
export interface StatItem { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }
export function StatCards({ items }: { items: StatItem[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {items.map((s, i) => (
        <Card key={i} className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{s.label}</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{s.value}</div>
          {s.sub && <div className="mt-1 text-xs text-gray-500">{s.sub}</div>}
        </Card>
      ))}
    </div>
  );
}

/** 目录卡片网格（Sources/Destinations/Functions…） */
export interface CatalogItem {
  icon?: LucideIcon; name: string; term?: string; desc?: string;
  status?: { tone: Tone; label: string }; to?: string; meta?: ReactNode;
}
export function Catalog({ items, columns = 3 }: { items: CatalogItem[]; columns?: 2 | 3 | 4 }) {
  const col = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" }[columns];
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${col}`}>
      {items.map((it, i) => {
        const inner = (
          <Card className={`flex h-full flex-col p-5 ${it.to ? "transition-shadow hover:shadow-md" : ""}`}>
            <div className="mb-3 flex items-center justify-between">
              {it.icon ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <it.icon className="h-5 w-5" />
                </div>
              ) : <span />}
              {it.status && <StatusPill tone={it.status.tone}>{it.status.label}</StatusPill>}
            </div>
            <div className="font-semibold text-gray-900">{it.name}</div>
            {it.term && <div className="text-[11px] uppercase tracking-wide text-gray-400">{it.term}</div>}
            {it.desc && <div className="mt-1 text-sm text-gray-500">{it.desc}</div>}
            {it.meta && <div className="mt-3 text-sm text-gray-500">{it.meta}</div>}
          </Card>
        );
        return it.to ? <Link key={i} to={it.to}>{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

/** 事件时间线 */
export interface TimelineItem { time: string; title: string; desc?: string; tone?: Tone }
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative ml-2 border-l border-gray-200">
      {items.map((e, i) => (
        <li key={i} className="mb-5 ml-5">
          <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
            e.tone === "amber" ? "bg-amber-400" : e.tone === "red" ? "bg-red-400" : "bg-brand-400"}`} />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{e.title}</span>
            <span className="text-xs text-gray-400">{e.time}</span>
          </div>
          {e.desc && <div className="mt-0.5 text-sm text-gray-500">{e.desc}</div>}
        </li>
      ))}
    </ol>
  );
}

/** 空状态 */
export function EmptyState({ icon: Icon, title, desc, action }: {
  icon: LucideIcon; title: string; desc?: string; action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon className="h-6 w-6" />
      </div>
      <div className="font-semibold text-gray-900">{title}</div>
      {desc && <div className="max-w-sm text-sm text-gray-500">{desc}</div>}
      {action}
    </Card>
  );
}

/** 子页签（Link 式 pill tabs） */
export function SubTabs({ tabs }: { tabs: { label: string; to: string; active?: boolean }[] }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-gray-200">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            t.active ? "border-brand-500 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/** 迷你折线图（纯 SVG，sparkline） */
export function Sparkline({ data, height = 48, color = "#3fa67e" }: { data: number[]; height?: number; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const w = 100, step = w / (data.length - 1 || 1);
  const pts = data.map((d, i) => `${(i * step).toFixed(1)},${(height - ((d - min) / span) * height).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
