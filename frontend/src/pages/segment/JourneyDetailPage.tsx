import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Pause, Archive, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Badge } from "../../components/ui";
import { StatCards, StatusPill, SubTabs } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  getJourney, getJourneyStats, listJourneyState, setJourneyStatus, deleteJourney,
  type Journey, type JourneyStats, type JourneyState, type JourneyStatus,
} from "../../api/engage";

const STATUS_TONE: Record<JourneyStatus, "green" | "amber" | "gray" | "blue"> = {
  active: "green", paused: "amber", draft: "blue", archived: "gray",
};

export default function JourneyDetailPage() {
  const { id } = useParams();
  const journeyId = Number(id);
  const { tenant } = useTenant();
  const { tr } = useLang();
  const navigate = useNavigate();

  const STATUS_LABEL: Record<JourneyStatus, string> = {
    active: tr("运行中", "Active"),
    paused: tr("已暂停", "Paused"),
    draft: tr("草稿", "Draft"),
    archived: tr("已归档", "Archived"),
  };
  const STEP_LABEL: Record<string, string> = {
    action: tr("动作", "Action"),
    wait: tr("等待", "Wait"),
    split: tr("分流", "Split"),
    exit: tr("退出", "Exit"),
  };
  const COL = {
    order: tr("顺序", "Order"),
    name: tr("名称", "Name"),
    type: tr("类型", "Type"),
    action: tr("动作", "Action"),
    waitHours: tr("等待小时", "Wait Hours"),
    destination: tr("目的地", "Destination"),
    oneId: "OneID",
    currentStep: tr("当前步骤", "Current Step"),
    status: tr("状态", "Status"),
    enteredAt: tr("进入时间", "Entered At"),
  };

  const [journey, setJourney] = useState<Journey | null>(null);
  const [stats, setStats] = useState<JourneyStats | null>(null);
  const [state, setState] = useState<JourneyState[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setErr(null);
    getJourney(tenant, journeyId).then(setJourney).catch((e) => setErr(String(e)));
    getJourneyStats(tenant, journeyId).then(setStats).catch(() => {});
    listJourneyState(tenant, journeyId).then(setState).catch(() => {});
  }
  useEffect(reload, [tenant, journeyId]);

  async function changeStatus(status: JourneyStatus) {
    setBusy(true);
    try {
      const j = await setJourneyStatus(tenant, journeyId, status);
      setJourney(j);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm(tr("确认删除该旅程？将同时删除步骤与运行状态。", "Delete this journey? Its steps and run state will be removed as well."))) return;
    setBusy(true);
    try {
      await deleteJourney(tenant, journeyId);
      navigate("/engage/journeys");
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  const stepRows = (journey?.steps || []).map((s) => ({
    [COL.order]: s.step_order,
    [COL.name]: s.step_name || "—",
    [COL.type]: s.step_type ? (STEP_LABEL[s.step_type] ?? s.step_type) : "—",
    [COL.action]: s.action_type || "—",
    [COL.waitHours]: s.wait_duration_hours ?? "—",
    [COL.destination]: s.destination_id || "—",
  }));

  const stateRows = (state || []).map((s) => ({
    [COL.oneId]: s.one_id || "—",
    [COL.currentStep]: s.current_step_id ?? "—",
    [COL.status]: s.status,
    [COL.enteredAt]: s.entered_at || "—",
  }));

  return (
    <Layout
      title={journey ? (journey.journey_name || journey.journey_code) : tr("旅程详情", "Journey Details")}
      subtitle={journey?.description || journey?.journey_code || ""}
      actions={journey && (
        <div className="flex items-center gap-2">
          <StatusPill tone={STATUS_TONE[journey.status] ?? "gray"}>
            {STATUS_LABEL[journey.status] ?? journey.status}
          </StatusPill>
          {journey.status !== "active" && (
            <Button variant="outline" onClick={() => changeStatus("active")} disabled={busy}>
              <Play className="h-4 w-4" /> {tr("启动", "Start")}
            </Button>
          )}
          {journey.status === "active" && (
            <Button variant="outline" onClick={() => changeStatus("paused")} disabled={busy}>
              <Pause className="h-4 w-4" /> {tr("暂停", "Pause")}
            </Button>
          )}
          <Button variant="outline" onClick={() => changeStatus("archived")} disabled={busy}>
            <Archive className="h-4 w-4" /> {tr("归档", "Archive")}
          </Button>
          <Button variant="ghost" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" /> {tr("删除", "Delete")}
          </Button>
        </div>
      )}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!journey && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {journey && (
        <>
          <StatCards items={[
            { label: tr("进入总人数", "Total Entered"), value: (stats?.total ?? 0).toLocaleString() },
            { label: tr("进行中", "In Progress"), value: (stats?.active ?? 0).toLocaleString() },
            { label: tr("已完成", "Completed"), value: (stats?.completed ?? 0).toLocaleString() },
            { label: tr("已退出", "Exited"), value: (stats?.exited ?? 0).toLocaleString() },
          ]} />

          <SubTabs tabs={[{ label: tr("步骤与运行", "Steps & Runs"), to: "#", active: true }]} />

          <Card className="mb-6 p-2">
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <div className="text-sm font-semibold text-gray-700">{tr("旅程步骤", "Journey Steps")}</div>
              <Badge color="brand">{journey.steps?.length ?? 0} {tr("步", "steps")}</Badge>
            </div>
            <DataTable columns={[COL.order, COL.name, COL.type, COL.action, COL.waitHours, COL.destination]} rows={stepRows} />
          </Card>

          <Card className="p-2">
            <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">
              {tr("在旅程中的用户", "Users in Journey")} <span className="ml-2 font-normal text-gray-400">{tr("· 最近 50 条", "· Latest 50")}</span>
            </div>
            <DataTable columns={[COL.oneId, COL.currentStep, COL.status, COL.enteredAt]} rows={stateRows} />
          </Card>
        </>
      )}
    </Layout>
  );
}
