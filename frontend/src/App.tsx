import { type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantProvider } from "./context/TenantContext";
import { LangProvider } from "./context/LangContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ChatApp from "./components/chat/ChatApp";

// 路由 basename 与 Vite 的 base 保持一致（Vercel="/", nginx="/console"）。
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// 纯对话形态：删除全部功能页，只保留登录 + ChatApp 外壳。
// 一切数据操作经聊天（assistant → MCP 工具）完成，结果以对话内联卡片(ViewCard)呈现。
export default function App() {
  return (
    <TenantProvider>
    <LangProvider>
    <AuthProvider>
      <BrowserRouter basename={BASENAME}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><ChatApp /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </LangProvider>
    </TenantProvider>
  );
}
