import type { ReactNode } from "react";
import { Spinner } from "../../ui";

// 内联卡片外壳：对话流里所有 view 卡片统一的紧凑框架（标题 + loading/error + 内容）。
export default function CardShell({
  icon, title, subtitle, actions, loading, error, children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-3 py-2">
        {icon && <span className="text-brand-600">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-gray-900">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-gray-400">{subtitle}</div>}
        </div>
        {actions}
      </div>
      <div className="px-3 py-2.5 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-gray-400"><Spinner /> 加载中…</div>
        ) : error ? (
          <div className="py-2 text-[13px] text-red-600">{error}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
