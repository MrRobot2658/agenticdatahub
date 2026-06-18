import { http } from "./client";

// Airflow 调度任务状态（右侧面板用）。经 /api → sql-engine /connections/scheduler/*。
export interface DagRun {
  dag_run_id: string;
  state: string | null;            // queued / running / success / failed
  start_date?: string | null;
  end_date?: string | null;
  logical_date?: string | null;
  run_type?: string | null;
  tenant_id?: string | null;
  pipeline_id?: string | null;
}

export interface SchedulerRuns {
  engine: string;
  reachable: boolean;
  ui_url: string;
  dag_id: string;
  runs: DagRun[];
  error?: string;
}

export async function getSchedulerRuns(limit = 20): Promise<SchedulerRuns> {
  const { data } = await http.get(`/connections/scheduler/runs`, { params: { limit } });
  return data;
}
