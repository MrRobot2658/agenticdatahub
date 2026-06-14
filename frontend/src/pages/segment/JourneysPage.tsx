import { useEffect, useState } from "react";
import { Plus, Route as RouteIcon } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listJourneys, createJourney, type Journey, type JourneyStatus,
} from "../../api/engage";

const STATUS_TONE: Record<JourneyStatus, "green" | "amber" | "gray" | "blue"> = {
  active: "green", paused: "amber", draft: "blue", archived: "gray",
};

export default function JourneysPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const STATUS_LABEL: Record<JourneyStatus, string> = {
    active: tr("运行中", "Active"), paused: tr("已暂停", "Paused"), draft: tr("草稿", "Draft"), archived: tr("已归档", "Archived"),
  };
  const TRIGGER_LABEL: Record<string, string> = {
    segment_entry: tr("进入受众", "Segment Entry"), event: tr("事件触发", "Event"), schedule: tr("定时", "Schedule"),
  };
  const COL = {
    journey: tr("旅程", "Journey"),
    code: tr("标识", "Identifier"),
    trigger: tr("触发方式", "Trigger"),
    steps: tr("步骤数", "Steps"),
    status: tr("状态", "Status"),
  };
  const [rows, setRows] = useState<Journey[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    setRows(null); setErr(null);
    listJourneys(tenant).then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(reload, [tenant]);

  async function onCreate() {
    if (!code.trim()) return;
    setSaving(true);
    try {
      await createJourney({
        tenant_id: tenant,
        journey_code: code.trim(),
        journey_name: name.trim() || code.trim(),
        trigger_type: "segment_entry",
        status: "draft",
      });
      setOpen(false); setCode(""); setName("");
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || String(e));
    } finally {
      setSaving(false);
    }
  }

  const view = (rows || []).map((j) => ({
    [COL.journey]: j.journey_name || j.journey_code,
    [COL.code]: j.journey_code,
    [COL.trigger]: j.trigger_type ? (TRIGGER_LABEL[j.trigger_type] ?? j.trigger_type) : "—",
    [COL.steps]: j.steps?.length ?? 0,
    [COL.status]: <StatusPill tone={STATUS_TONE[j.status] ?? "gray"}>{STATUS_LABEL[j.status] ?? j.status}</StatusPill>,
    _id: j.journey_id,
  }));

  return (
    <Layout
      title={tr("旅程 Journeys", "Journeys")}
      subtitle={tr("编排多步骤的用户自动化旅程，按条件分流与触达", "Orchestrate multi-step automated user journeys, branching and reaching out by conditions")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建旅程", "New Journey")}</Button>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {rows && (
        <>
          <StatCards items={[
            { label: tr("旅程总数", "Total Journeys"), value: rows.length },
            { label: tr("运行中", "Active"), value: rows.filter((j) => j.status === "active").length },
            { label: tr("草稿", "Draft"), value: rows.filter((j) => j.status === "draft").length },
            { label: tr("已暂停", "Paused"), value: rows.filter((j) => j.status === "paused").length },
          ]} />
          {rows.length === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title={tr("还没有旅程", "No journeys yet")}
              desc={tr("创建一个旅程，从受众进入、事件或定时触发，编排自动化触达。", "Create a journey triggered by segment entry, an event or a schedule to orchestrate automated outreach.")}
              action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建第一个旅程", "Create your first journey")}</Button>}
            />
          ) : (
            <Card className="p-2">
              <DataTable
                columns={[COL.journey, COL.code, COL.trigger, COL.steps, COL.status]}
                rows={view}
                rowLink={(r) => `/engage/journeys/${r._id}`}
              />
            </Card>
          )}
        </>
      )}

      <Modal open={open} title={tr("新建旅程", "New Journey")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("旅程标识（journey_code，唯一）", "Journey identifier (journey_code, unique)")} value={code} onChange={setCode} placeholder={tr("如 welcome_flow", "e.g. welcome_flow")} />
          <TextField label={tr("旅程名称", "Journey name")} value={name} onChange={setName} placeholder={tr("新用户欢迎旅程", "New user welcome journey")} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={onCreate} disabled={saving || !code.trim()}>
              {saving ? tr("创建中…", "Creating…") : tr("创建", "Create")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
