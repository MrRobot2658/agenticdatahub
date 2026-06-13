import { useParams } from "react-router-dom";
import Layout from "../components/layout/Layout";
import UnifiedFilter from "../components/filter/UnifiedFilter";
import { byKey } from "../lib/objects";
import TagsPage from "./TagsPage";
import SegmentsPage from "./SegmentsPage";

export default function ObjectListPage() {
  const { key = "user" } = useParams();
  const cfg = byKey(key);
  if (!cfg) return <Layout title="未知对象"><div className="text-gray-500">未知对象：{key}</div></Layout>;

  if (cfg.kind === "tag") return <TagsPage />;
  if (cfg.kind === "segment") return <SegmentsPage />;

  return (
    <Layout title={cfg.label} subtitle={cfg.desc}>
      <UnifiedFilter baseObject={cfg.key} lockBase autoSearch />
    </Layout>
  );
}
