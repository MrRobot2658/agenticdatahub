import type { ChatView } from "../../../api/assistant";
import ProfileCard from "./ProfileCard";
import AudienceCard from "./AudienceCard";
import TableCard from "./TableCard";
import ChartCard from "./ChartCard";

// 渲染指令分发：把 agent 返回的 view 映射到对应内联卡片。
export default function ViewCard({ view }: { view: ChatView }) {
  switch (view.type) {
    case "profile": return <ProfileCard one_id={view.one_id} />;
    case "audience": return <AudienceCard query={view.query} />;
    case "table": return <TableCard object={view.object} query={view.query} />;
    case "chart": return <ChartCard question={view.question} />;
    default: return null;
  }
}
