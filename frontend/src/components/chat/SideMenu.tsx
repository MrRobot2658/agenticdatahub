import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { HOME, SECTIONS, FOOTER_SECTION, type NavChild, type NavSection } from "../../lib/nav";
import { useLang } from "../../context/LangContext";

// 左侧基本菜单（chat-native）：基于 nav.ts 的折叠导航树。点击任一条「操作路径」，
// 由 ChatApp 以抽屉卡片渲染对应页面。这里只负责导航选择，不自己跳路由。
export default function SideMenu({ onOpen, activePath }: { onOpen: (path: string, label: string) => void; activePath: string | null }) {
  const { lang } = useLang();
  const txt = (it: { label: string; term?: string }) => (lang === "en" ? it.term ?? it.label : it.label);

  const Leaf = ({ item, indent }: { item: NavChild; indent?: boolean }) => (
    <button
      type="button"
      onClick={() => onOpen(item.to, txt(item))}
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-[13px] ${indent ? "pl-8" : "pl-2"} ${
        activePath === item.to ? "bg-brand-50 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{txt(item)}</span>
    </button>
  );

  const Section = ({ section }: { section: NavSection }) => {
    const [open, setOpen] = useState(false);
    if (!section.children) return <Leaf item={section} />;
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-gray-600 hover:bg-gray-100"
        >
          <section.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate font-medium">{txt(section)}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-0.5 space-y-0.5">
            {section.children.map((c) => <Leaf key={c.to} item={c} indent />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      <Leaf item={HOME} />
      {SECTIONS.map((s) => <Section key={s.to} section={s} />)}
      <Section section={FOOTER_SECTION} />
    </div>
  );
}
