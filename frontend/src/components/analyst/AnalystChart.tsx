import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { Card, Spinner, Modal, DataTable } from "../ui";
import { useLang } from "../../context/LangContext";
import {
  getChartData, drilldown,
  type ChartType, type ChartPoint, type DrilldownResult,
} from "../../api/analyst";

const PALETTE = ["#52bd94", "#3aa0ff", "#f5a623", "#a78bfa", "#f97316", "#ec4899", "#14b8a6", "#64748b"];

interface AnalystChartProps {
  tenant: number;
  title: string;
  type: ChartType;
  source: string;
  data?: ChartPoint[];
  onDelete?: () => void;
}

// 可下钻图表：渲染 recharts 图，点击数据点弹出明细 Modal。
export default function AnalystChart({ tenant, title, type, source, data: dataProp, onDelete }: AnalystChartProps) {
  const { tr } = useLang();
  const [data, setData] = useState<ChartPoint[] | null>(dataProp ?? null);
  const [loading, setLoading] = useState(false);

  // 下钻 Modal 状态
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillLabel, setDrillLabel] = useState("");
  const [drillResult, setDrillResult] = useState<DrilldownResult | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    if (dataProp) { setData(dataProp); return; }
    let alive = true;
    setLoading(true);
    getChartData(tenant, source)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, source, dataProp]);

  async function openDrill(label: string) {
    setDrillLabel(label);
    setDrillResult(null);
    setDrillOpen(true);
    setDrillLoading(true);
    try {
      const r = await drilldown(tenant, source, label);
      setDrillResult(r);
    } catch {
      setDrillResult({ columns: [], rows: [], count: 0, label });
    } finally {
      setDrillLoading(false);
    }
  }

  const points = data ?? [];

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-400">{tr("点击图表下钻明细", "Click to drill down")}</div>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title={tr("删除", "Delete")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-[240px] items-center justify-center"><Spinner /></div>
      ) : points.length === 0 ? (
        <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
          {tr("暂无数据", "No data")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          {type === "bar" ? (
            <BarChart data={points} onClick={(s: any) => s?.activeLabel && openDrill(String(s.activeLabel))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#52bd94" radius={[4, 4, 0, 0]} cursor="pointer" />
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={points} onClick={(s: any) => s?.activeLabel && openDrill(String(s.activeLabel))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#52bd94" strokeWidth={2} dot activeDot={{ cursor: "pointer" }} />
            </LineChart>
          ) : type === "area" ? (
            <AreaChart data={points} onClick={(s: any) => s?.activeLabel && openDrill(String(s.activeLabel))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="value" stroke="#52bd94" fill="#cdeedd" activeDot={{ cursor: "pointer" }} />
            </AreaChart>
          ) : (
            <PieChart>
              <Pie
                data={points}
                dataKey="value"
                nameKey="label"
                outerRadius={90}
                label
                cursor="pointer"
                onClick={(_: any, idx: number) => openDrill(String(points[idx].label))}
              >
                {points.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          )}
        </ResponsiveContainer>
      )}

      <Modal
        open={drillOpen}
        title={`${tr("明细", "Details")} · ${title} = ${drillLabel}`}
        onClose={() => setDrillOpen(false)}
      >
        {drillLoading ? (
          <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
        ) : drillResult && drillResult.rows.length > 0 ? (
          <div className="space-y-2">
            <DataTable
              columns={drillResult.columns}
              rows={drillResult.rows.map((row) => {
                const obj: Record<string, string> = {};
                drillResult.columns.forEach((c) => { obj[c] = row[c]; });
                return obj;
              })}
            />
            <div className="text-xs text-gray-400">
              {tr(`共 ${drillResult.count} 条`, `${drillResult.count} records`)}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-400">{tr("暂无明细", "No records")}</div>
        )}
      </Modal>
    </Card>
  );
}
