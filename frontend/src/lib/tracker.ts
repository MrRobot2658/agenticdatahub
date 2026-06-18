// 轻量上下文记录器（前端单例）。
// 历史：曾是「主动式埋点 Copilot」——采集鼠标/idle/反复横跳等行为并 POST /observe，
// 由后端反推意图、推送主动建议气泡。对话式（agent-first）形态下已废弃该模式：
// 不再监控行为、不再上报、不再弹窗。仅保留当前页面上下文与最小 API，供既有调用方（client.ts
// 的错误埋点等）无痛引用。建议改由 agent 在对话中顺势给出（纯反应式）。
import { type ProactiveSuggestion } from "../api/assistant";

type SuggestionListener = (s: ProactiveSuggestion) => void;

class Tracker {
  private tenant = 0;
  private userId: number | undefined;
  private page: { path: string; name?: string } = { path: "/" };

  configure(tenant: number, userId?: number) {
    this.tenant = tenant;
    this.userId = userId;
  }

  /** 当前画布所在页面（供 agent 上下文，可选使用）。 */
  get currentPage() {
    return this.page;
  }

  // —— 以下为兼容旧调用的空操作（不再监控行为 / 不再上报 / 不再触发主动建议）——
  get dnd(): boolean {
    return false;
  }
  setDnd(_v: boolean) {
    /* no-op：主动建议已下线 */
  }
  onSuggestion(_cb: SuggestionListener): () => void {
    return () => {};
  }
  track(_type: string, _payload?: Record<string, any>) {
    /* no-op：不再缓冲/上报行为事件 */
  }
  pageView(path: string, name?: string) {
    this.page = { path, name }; // 仅更新上下文，不上报
  }
  noteActivity() {
    /* no-op */
  }
  async flush(_reason?: string) {
    /* no-op */
  }
}

export const tracker = new Tracker();
