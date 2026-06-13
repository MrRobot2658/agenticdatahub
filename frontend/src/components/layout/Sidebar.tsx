import { NavLink, useLocation } from "react-router-dom";
import { HOME, SECTIONS, FOOTER_SECTION, type NavChild, type NavSection } from "../../lib/nav";

const rowBase =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
const active = "bg-brand-50 text-brand-700 font-semibold";
const idle = "text-gray-600 hover:bg-gray-100 hover:text-gray-900";

function TopItem({ item }: { item: NavChild }) {
  return (
    <NavLink to={item.to} end className={({ isActive }) => `${rowBase} ${isActive ? active : idle}`}>
      <item.icon className="h-[18px] w-[18px] shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.term && <span className="text-[11px] font-normal text-gray-400">{item.term}</span>}
    </NavLink>
  );
}

function ChildItem({ item }: { item: NavChild }) {
  return (
    <NavLink
      to={item.to}
      end
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md py-1.5 pl-9 pr-3 text-[13px] transition-colors ${
          isActive ? "bg-brand-50 font-medium text-brand-700" : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
        }`
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      <span className="text-[10px] text-gray-400">{item.term}</span>
    </NavLink>
  );
}

function Section({ section, expanded }: { section: NavSection; expanded: boolean }) {
  return (
    <div>
      <NavLink
        to={section.to}
        end
        className={({ isActive }) => `${rowBase} ${isActive ? active : idle}`}
      >
        <section.icon className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 font-medium">{section.label}</span>
        <span className="text-[11px] font-normal text-gray-400">{section.term}</span>
      </NavLink>
      {expanded && section.children && (
        <div className="mt-1 space-y-0.5">
          {section.children.map((c) => <ChildItem key={c.to} item={c} />)}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-400 text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M3 13.5h11.5a3.5 3.5 0 0 1 0 7H7a1 1 0 1 1 0-2h7.5a1.5 1.5 0 0 0 0-3H3a1 1 0 0 1 0-2Zm6.5-10H17a1 1 0 1 1 0 2H9.5a1.5 1.5 0 0 0 0 3H21a1 1 0 1 1 0 2H9.5a3.5 3.5 0 0 1 0-7Z" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-gray-900">Segment</div>
          <div className="text-[11px] text-gray-400">CDP · 客户数据平台</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        <TopItem item={HOME} />
        <div className="!mt-3 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Workspace
        </div>
        {SECTIONS.map((s) => (
          <Section key={s.to} section={s} expanded={pathname === s.to || pathname.startsWith(s.to + "/")} />
        ))}
        <div className="!mt-3 border-t border-gray-200 pt-3">
          <Section
            section={FOOTER_SECTION}
            expanded={pathname === FOOTER_SECTION.to || pathname.startsWith(FOOTER_SECTION.to + "/")}
          />
        </div>
      </nav>

      <div className="border-t border-gray-200 px-5 py-3 text-[11px] text-gray-400">
        sql-engine · DSL 引擎
      </div>
    </aside>
  );
}
