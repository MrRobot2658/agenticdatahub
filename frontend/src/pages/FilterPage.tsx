import Layout from "../components/layout/Layout";
import UnifiedFilter from "../components/filter/UnifiedFilter";

export default function FilterPage() {
  return (
    <Layout
      title="创建受众 Build Audience"
      subtitle="多条件 / 多条线 / 跨对象链式关联 + 边条件，支持自然语言；实时预估人数与 SQL 预览，可存为受众"
    >
      <UnifiedFilter />
    </Layout>
  );
}
