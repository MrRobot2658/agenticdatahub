// 本地偏好：长期记忆 / 技能开关 / Token 消耗估算。均存 localStorage（无后端依赖）。

// ── 长期记忆（作为 system 上下文注入对话）─────────────────────────────────
const MEM_KEY = "da_memory";
export function getMemory(): string {
  try { return localStorage.getItem(MEM_KEY) || ""; } catch { return ""; }
}
export function setMemory(v: string): void {
  try { localStorage.setItem(MEM_KEY, v); } catch { /* ignore */ }
}

// ── 技能开关（key → 启用）。缺省视为启用。─────────────────────────────────
const SKILL_KEY = "da_skills_disabled";
export function getDisabledSkills(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SKILL_KEY) || "[]")); } catch { return new Set(); }
}
export function toggleSkill(key: string, enabled: boolean): void {
  const s = getDisabledSkills();
  if (enabled) s.delete(key); else s.add(key);
  try { localStorage.setItem(SKILL_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

// ── Token 消耗（客户端估算：CJK≈1.5 字符/token，其它≈4 字符/token）─────────
const USAGE_KEY = "da_token_usage";
export interface Usage { session: number; total: number }
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0, other = 0;
  for (const ch of text) {
    if (/[　-鿿＀-￯]/.test(ch)) cjk++; else other++;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}
function readUsage(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    return { session: Number(u.session) || 0, total: Number(u.total) || 0 };
  } catch { return { session: 0, total: 0 }; }
}
export function addTokens(text: string): void {
  const t = estimateTokens(text);
  if (!t) return;
  const u = readUsage();
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ session: u.session + t, total: u.total + t })); } catch { /* ignore */ }
}
export function getUsage(): Usage { return readUsage(); }
export function resetSessionUsage(): void {
  const u = readUsage();
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ session: 0, total: u.total })); } catch { /* ignore */ }
}
