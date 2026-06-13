import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantProvider } from "./context/TenantContext";
import Dashboard from "./pages/Dashboard";
import FilterPage from "./pages/FilterPage";
import EtlPage from "./pages/EtlPage";
import ObjectListPage from "./pages/ObjectListPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import DestinationsPage from "./pages/DestinationsPage";
import UnifyPage from "./pages/UnifyPage";
import EngagePage from "./pages/EngagePage";
import TagsPage from "./pages/TagsPage";

// Connections
import FunctionsPage from "./pages/segment/FunctionsPage";
import ReverseEtlPage from "./pages/segment/ReverseEtlPage";
import WarehousesPage from "./pages/segment/WarehousesPage";
import SourceDetailPage from "./pages/segment/SourceDetailPage";
// Unify
import ProfileDetailPage from "./pages/segment/ProfileDetailPage";
import IdentityResolutionPage from "./pages/segment/IdentityResolutionPage";
import SqlTraitsPage from "./pages/segment/SqlTraitsPage";
import PredictionsPage from "./pages/segment/PredictionsPage";
import ProfilesSyncPage from "./pages/segment/ProfilesSyncPage";
// Engage
import JourneysPage from "./pages/segment/JourneysPage";
import BroadcastsPage from "./pages/segment/BroadcastsPage";
import AudienceDetailPage from "./pages/segment/AudienceDetailPage";
// Protocols
import TrackingPlansPage from "./pages/segment/TrackingPlansPage";
import ViolationsPage from "./pages/segment/ViolationsPage";
import TransformationsPage from "./pages/segment/TransformationsPage";
// Privacy
import DataControlsPage from "./pages/segment/DataControlsPage";
import ConsentPage from "./pages/segment/ConsentPage";
import DeletionPage from "./pages/segment/DeletionPage";
// Monitor
import DeliveryPage from "./pages/segment/DeliveryPage";
import AlertsPage from "./pages/segment/AlertsPage";
import EventLogsPage from "./pages/segment/EventLogsPage";
// Settings
import SettingsGeneralPage from "./pages/segment/SettingsGeneralPage";
import AccessPage from "./pages/segment/AccessPage";
import TokensPage from "./pages/segment/TokensPage";
import AuditPage from "./pages/segment/AuditPage";

// 生产挂在 /console 下，dev 用根路径
const BASENAME = import.meta.env.PROD ? "/console" : "/";

export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter basename={BASENAME}>
        <Routes>
          {/* Overview */}
          <Route path="/" element={<Dashboard />} />

          {/* Connections */}
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/connections/destinations" element={<DestinationsPage />} />
          <Route path="/connections/reverse-etl" element={<ReverseEtlPage />} />
          <Route path="/connections/warehouses" element={<WarehousesPage />} />
          <Route path="/connections/functions" element={<FunctionsPage />} />
          <Route path="/connections/sources/new" element={<EtlPage />} />
          <Route path="/connections/sources/:id" element={<SourceDetailPage />} />

          {/* Unify */}
          <Route path="/unify" element={<UnifyPage />} />
          <Route path="/unify/identity" element={<IdentityResolutionPage />} />
          <Route path="/unify/traits" element={<TagsPage />} />
          <Route path="/unify/sql-traits" element={<SqlTraitsPage />} />
          <Route path="/unify/predictions" element={<PredictionsPage />} />
          <Route path="/unify/sync" element={<ProfilesSyncPage />} />
          <Route path="/unify/profiles/:id" element={<ProfileDetailPage />} />
          <Route path="/unify/objects/:key" element={<ObjectListPage />} />

          {/* Engage */}
          <Route path="/engage" element={<EngagePage />} />
          <Route path="/engage/audiences/new" element={<FilterPage />} />
          <Route path="/engage/audiences/:id" element={<AudienceDetailPage />} />
          <Route path="/engage/journeys" element={<JourneysPage />} />
          <Route path="/engage/broadcasts" element={<BroadcastsPage />} />

          {/* Protocols */}
          <Route path="/protocols" element={<TrackingPlansPage />} />
          <Route path="/protocols/violations" element={<ViolationsPage />} />
          <Route path="/protocols/transformations" element={<TransformationsPage />} />

          {/* Privacy */}
          <Route path="/privacy" element={<DataControlsPage />} />
          <Route path="/privacy/consent" element={<ConsentPage />} />
          <Route path="/privacy/deletion" element={<DeletionPage />} />

          {/* Monitor */}
          <Route path="/monitor" element={<DeliveryPage />} />
          <Route path="/monitor/alerts" element={<AlertsPage />} />
          <Route path="/monitor/logs" element={<EventLogsPage />} />

          {/* Settings */}
          <Route path="/settings" element={<SettingsGeneralPage />} />
          <Route path="/settings/access" element={<AccessPage />} />
          <Route path="/settings/tokens" element={<TokensPage />} />
          <Route path="/settings/audit" element={<AuditPage />} />

          {/* 旧路由别名（外链兼容） */}
          <Route path="/filter" element={<Navigate to="/engage/audiences/new" replace />} />
          <Route path="/etl" element={<Navigate to="/connections/sources/new" replace />} />
          <Route path="/engage/traits" element={<Navigate to="/unify/traits" replace />} />
          <Route path="/objects/:key" element={<ObjectListPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TenantProvider>
  );
}
