import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { nlChart, type Chart } from "../../../api/analyst";
import { useTenant } from "../../../context/TenantContext";
import CardShell from "./CardShell";

// 图表内联卡片：NL→图表（nlChart）→ recharts 直接在对话里渲染（不落库）。
const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];

export default function ChartCard({ question }: { question: string }) {
  const { tenant } = useTenant();
  const [chart, setChart] = useState<Chart | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setChart(undefined); setErr(null);
    nlChart(tenant, question)
      .then((c) => setChart(c))
      .catch((e) => setErr(e?.response?.data?.detail || String(e)));
  }, [question, tenant]);

  const data = chart?.data ?? [];

  return (
    <CardShell
      icon={<BarChart3 className="h-4 w-4" />}
      title={chart?.title || "图表"}
      subtitle={chart ? `${chart.type} · ${data.length} 项` : question}
      loading={chart === undefined && !err}
      error={err}
    >
      {chart && (data.length === 0 ? (
        <div className="text-[13px] text-gray-400">无数据</div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {renderChart(chart, data)}
          </ResponsiveContainer>
        </div>
      ))}
    </CardShell>
  );
}

function renderChart(chart: Chart, data: { label: string; value: number }[]) {
  if (chart.type === "pie") {
    return (
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.label}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    );
  }
  if (chart.type === "line") {
    return (
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
      </LineChart>
    );
  }
  if (chart.type === "area") {
    return (
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
        <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#c7d2fe" />
      </AreaChart>
    );
  }
  return (
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
      <XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
        {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
      </Bar>
    </BarChart>
  );
}
