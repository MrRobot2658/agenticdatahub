import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, GitBranch } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { byKey } from "../lib/objects";
import { getRecord, getRecordRelations, type RecordRelation } from "../api/objects";

const objLabel = (k?: string) => (k ? byKey(k)?.label ?? k : "—");
const fmt = (v: any) =>
  v == null ? "—" : (typeof v === "object" ? JSON.stringify(v) : String(v));

// 记录详情：GET /objects/{tenant}/{key}/{pk} + .../{pk}/relations
export default function ObjectRecordDetailPage() {
  const { key = "", pk = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const cfg = byKey(key);
  const COL = {
    rel: tr("关系", "Relation"),
    dir: tr("方向", "Direction"),
    peer: tr("对端对象", "Related Object"),
    peerId: tr("对端ID", "Related ID"),
    props: tr("属性", "Properties"),
    time: tr("时间", "Time"),
  };
  const [record, setRecord] = useState<Record<string, any> | null>(null);
  const [rels, setRels] = useState<RecordRelation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRecord(null); setRels(null); setErr(null);
    getRecord(tenant, key, pk).then((r) => setRecord(r || {})).catch((e) => setErr(String(e)));
    getRecordRelations(tenant, key, pk).then((r) => setRels(r || [])).catch(() => setRels([]));
  }, [tenant, key, pk]);

  // 对端对象 + 对端 id（按方向取另一侧）
  const relRow = (r: RecordRelation) => {
    const reverse = r.direction === "reverse";
    const peerType = reverse ? r.src_type : r.dst_type;
    const peerId = reverse ? r.src_id : r.dst_id;
    return {
      [COL.rel]: r.rel_type,
      [COL.dir]: reverse ? tr("入边 ←", "Inbound ←") : tr("出边 →", "Outbound →"),
      [COL.peer]: objLabel(peerType),
      [COL.peerId]: peerId ?? "—",
      [COL.props]: r.properties ? JSON.stringify(r.properties) : "—",
      [COL.time]: r.create_time ?? "—",
      _link: peerType && peerId ? `/objects/${peerType}/${peerId}` : undefined,
    };
  };

  return (
    <Layout
      title={`${objLabel(key)} · ${pk}`}
      subtitle={`${tr("记录详情", "Record detail")} · ${key} / ${pk}`}
      actions={
        <Link to={`/objects/${key}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
          <ArrowLeft className="h-4 w-4" /> {tr("返回", "Back to ")}{objLabel(key)}{tr("列表", " list")}
        </Link>
      }
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!record && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {record && (
        <>
          <StatCards items={[
            { label: tr("对象", "Object"), value: objLabel(key) },
            { label: tr("主键", "Primary Key"), value: cfg?.key ?? key },
            { label: "ID", value: pk },
            { label: tr("关系数", "Relations"), value: rels ? rels.length : "…" },
          ]} />

          <div className="mb-3 text-sm font-semibold text-gray-700">{tr("字段 Properties", "Properties")}</div>
          <Card className="mb-8 p-5">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {Object.entries(record).map(([k, v]) => (
                <div key={k} className="flex flex-col border-b border-gray-50 pb-2">
                  <dt className="text-xs uppercase tracking-wide text-gray-400">{k}</dt>
                  <dd className="mt-0.5 break-all text-sm text-gray-800">{fmt(v)}</dd>
                </div>
              ))}
              {Object.keys(record).length === 0 && <div className="text-sm text-gray-400">{tr("无字段", "No fields")}</div>}
            </dl>
          </Card>

          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <GitBranch className="h-4 w-4 text-brand-500" /> {tr("关联记录 Relations", "Relations")}
            {rels && <Badge color="brand">{rels.length}</Badge>}
            <span className="font-normal text-gray-400">· {tr("点击行查看对端记录", "Click a row to view the related record")}</span>
          </div>
          <Card className="p-2">
            {!rels ? (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-500"><Spinner /> {tr("加载关系…", "Loading relations…")}</div>
            ) : (
              <DataTable
                columns={[COL.rel, COL.dir, COL.peer, COL.peerId, COL.props, COL.time]}
                rows={rels.map(relRow)}
                rowLink={(r) => r._link}
              />
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}
