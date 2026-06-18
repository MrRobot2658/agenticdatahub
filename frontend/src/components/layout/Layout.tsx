import type { ReactNode } from "react";
import { useEmbedded } from "../../context/EmbeddedContext";

// 画布模式 Layout：外壳（ChatApp）已提供对话/菜单/滚动容器，页面只渲染标题栏 + 内容。
// 嵌入聊天卡片时（EmbeddedCtx=true）走紧凑排版：小标题、无 max-w-7xl、少留白，适配对话框。
export default function Layout({
  title, subtitle, actions, children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const embedded = useEmbedded();
  return (
    <div className={embedded ? "px-3 py-3" : "mx-auto max-w-7xl px-6 py-6"}>
      <div className={`flex items-start justify-between gap-4 ${embedded ? "mb-3" : "mb-6"}`}>
        <div className="min-w-0">
          <h1 className={`tracking-tight text-gray-900 ${embedded ? "text-base font-semibold" : "text-2xl font-bold"}`}>{title}</h1>
          {subtitle && <div className={`text-gray-500 ${embedded ? "mt-0.5 text-xs" : "mt-1 text-sm"}`}>{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
