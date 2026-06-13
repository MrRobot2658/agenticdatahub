import { Sparkles } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Catalog, MockTag, type CatalogItem } from "../../components/segment/kit";
import { predictions } from "../../mock/data";

export default function PredictionsPage() {
  const items: CatalogItem[] = predictions.map((p) => ({
    icon: Sparkles,
    name: p.name,
    term: `预测目标 ${p.target}`,
    desc: `窗口 ${p.horizon} · 覆盖 ${p.coverage}`,
    status: p.quality === "良好"
      ? { tone: "green" as const, label: p.quality }
      : { tone: "amber" as const, label: p.quality },
  }));
  return (
    <Layout
      title="预测 Predictions"
      subtitle="基于用户行为训练的倾向性预测模型"
      actions={<MockTag />}
    >
      <Catalog items={items} columns={3} />
    </Layout>
  );
}
