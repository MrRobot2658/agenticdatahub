import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { MockTag } from "../../components/segment/kit";
import { eventLogs } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function EventLogsPage() {
  const { tr } = useLang();
  const COL = {
    time: tr("时间", "Time"),
    source: tr("数据源", "Source"),
    event: tr("事件", "Event"),
    dest: tr("目的地", "Destination"),
    status: tr("状态", "Status"),
    http: "HTTP",
  };
  return (
    <Layout
      title={tr("事件日志 Event Logs", "Event Logs")}
      subtitle={tr("实时事件投递日志，逐条追踪数据源到目的地的处理结果", "Real-time event delivery logs, tracing each event's processing from source to destination")}
      actions={<MockTag />}
    >
      <Card className="p-2">
        <DataTable
          columns={[COL.time, COL.source, COL.event, COL.dest, COL.status, COL.http]}
          rows={eventLogs.map((e) => ({
            [COL.time]: e.time,
            [COL.source]: e.source,
            [COL.event]: e.event,
            [COL.dest]: e.dest,
            [COL.status]: e.status,
            [COL.http]: e.code,
          }))}
        />
      </Card>
    </Layout>
  );
}
