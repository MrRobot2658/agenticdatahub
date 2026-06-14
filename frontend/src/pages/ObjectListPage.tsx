import { useParams } from "react-router-dom";
import Layout from "../components/layout/Layout";
import UnifiedFilter from "../components/filter/UnifiedFilter";
import { byKey } from "../lib/objects";
import { useLang } from "../context/LangContext";
import TagsPage from "./TagsPage";
import SegmentsPage from "./SegmentsPage";

export default function ObjectListPage() {
  const { tr } = useLang();
  const { key = "user" } = useParams();
  const cfg = byKey(key);
  if (!cfg) return <Layout title={tr("未知对象", "Unknown object")}><div className="text-gray-500">{tr("未知对象", "Unknown object")}：{key}</div></Layout>;

  if (cfg.kind === "tag") return <TagsPage />;
  if (cfg.kind === "segment") return <SegmentsPage />;

  return (
    <Layout title={cfg.label} subtitle={cfg.desc}>
      <UnifiedFilter baseObject={cfg.key} lockBase autoSearch />
    </Layout>
  );
}
