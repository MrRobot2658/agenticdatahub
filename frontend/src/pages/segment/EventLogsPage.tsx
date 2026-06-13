import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { MockTag } from "../../components/segment/kit";
import { eventLogs } from "../../mock/data";

export default function EventLogsPage() {
  return (
    <Layout
      title="事件日志 Event Logs"
      subtitle="实时事件投递日志，逐条追踪数据源到目的地的处理结果"
      actions={<MockTag />}
    >
      <Card className="p-2">
        <DataTable
          columns={["时间", "数据源", "事件", "目的地", "状态", "HTTP"]}
          rows={eventLogs.map((e) => ({
            "时间": e.time,
            "数据源": e.source,
            "事件": e.event,
            "目的地": e.dest,
            "状态": e.status,
            "HTTP": e.code,
          }))}
        />
      </Card>
    </Layout>
  );
}
