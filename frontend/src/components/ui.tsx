import { isValidElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, color = "gray", title }: { children: ReactNode; color?: string; title?: string }) {
  const map: Record<string, string> = {
    gray: "bg-gray-100 text-gray-600",
    brand: "bg-brand-50 text-brand-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
  };
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[color] || map.gray}`}>
      {children}
    </span>
  );
}

export function Button({
  children, onClick, variant = "primary", disabled, type = "button", className = "",
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline";
  disabled?: boolean; type?: "button" | "submit"; className?: string;
}) {
  const styles: Record<string, string> = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-300",
    ghost: "text-gray-600 hover:bg-gray-100",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function DataTable({ columns, rows, rowLink }: {
  columns: string[];
  rows: Record<string, any>[];
  /** 返回链接则该行可点击进入详情 */
  rowLink?: (row: Record<string, any>) => string | undefined;
}) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
            {columns.map((c) => (
              <th key={c} className="px-4 py-3 font-semibold">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-gray-400">无数据</td></tr>
          )}
          {rows.map((r, i) => {
            const link = rowLink?.(r);
            return (
              <tr
                key={i}
                onClick={link ? () => navigate(link) : undefined}
                className={`hover:bg-gray-50 ${link ? "cursor-pointer" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-4 py-3 text-gray-700">{fmt(r[c])}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: any) {
  if (v == null) return <span className="text-gray-300">—</span>;
  if (isValidElement(v)) return v;                 // React 元素直接渲染（避免 JSON.stringify 循环引用崩溃）
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />;
}

export function Modal({
  open, title, onClose, children,
}: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-base font-semibold text-gray-900">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function TextField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
