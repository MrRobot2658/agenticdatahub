import Layout from "../components/layout/Layout";
import UnifiedFilter from "../components/filter/UnifiedFilter";
import { useLang } from "../context/LangContext";

export default function FilterPage() {
  const { tr } = useLang();
  return (
    <Layout
      title={tr("创建受众 Build Audience", "Build Audience")}
      subtitle={tr(
        "多条件 / 多条线 / 跨对象链式关联 + 边条件，支持自然语言；实时预估人数与 SQL 预览，可存为受众",
        "Multi-condition / multi-branch / cross-object chained relations + edge conditions, with natural language; real-time audience estimation and SQL preview, saveable as an audience"
      )}
    >
      <UnifiedFilter />
    </Layout>
  );
}
