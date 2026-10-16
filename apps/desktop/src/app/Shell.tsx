import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router";
import { t } from "../i18n/de";
import { PlainPage } from "../ui/Frames";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Bits";
import { ErrorBoundary } from "./ErrorBoundary";
import { ONBOARDING_PATH } from "./modules";
import { Palette } from "./Overlays";
import { InstallDialogHost } from "../features/install/InstallDialog";
import { Rail } from "./Rail";
import { useSettings } from "./theme";

const Start = lazy(() => import("../features/home/Start"));
const Programs = lazy(() => import("../features/programs/Programs"));
const Library = lazy(() => import("../features/library/Library"));
const PrintCheck = lazy(() => import("../features/printcheck/PrintCheck"));
const Mockup = lazy(() => import("../features/mockup/Mockup"));
const Social = lazy(() => import("../features/social/Social"));
const Cutout = lazy(() => import("../features/cutout/Cutout"));
const Settings = lazy(() => import("../features/settings/Settings"));

function Pending() {
  return (
    <div className="stage stage--plain" aria-busy="true">
      <header className="titlebar" />
      <main className="page" id="main" data-region="preview" tabIndex={-1} aria-label={t.common.region.main} />
    </div>
  );
}

function NotFound() {
  const n = t.shell.notFound;
  return (
    <PlainPage title={n.title}>
      <EmptyState>{n.text}</EmptyState>
      <p>
        <Button onClick={() => (window.location.hash = "/start")}>{n.action}</Button>
      </p>
    </PlainPage>
  );
}

function Guarded({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary resetKey={loc.pathname}>
      <Suspense fallback={<Pending />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function Shell() {
  const navigate = useNavigate();
  const settings = useSettings();
  const loc = useLocation();

  useEffect(() => {
    if (settings.data?.onboarding.status === "notStarted" && loc.pathname !== ONBOARDING_PATH)
      void navigate(ONBOARDING_PATH, { replace: true });
  }, [settings.data?.onboarding.status, loc.pathname, navigate]);

  return (
    <div className="app">
      <Rail />
      <Routes>
        <Route path="/" element={<RedirectStart />} />
        <Route
          path="/start"
          element={
            <Guarded>
              <Start />
            </Guarded>
          }
        />
        <Route
          path="/bibliothek"
          element={
            <Guarded>
              <Library />
            </Guarded>
          }
        />
        <Route
          path="/programme/*"
          element={
            <Guarded>
              <Programs />
            </Guarded>
          }
        />
        <Route
          path="/druck"
          element={
            <Guarded>
              <PrintCheck />
            </Guarded>
          }
        />
        <Route
          path="/mockups"
          element={
            <Guarded>
              <Mockup />
            </Guarded>
          }
        />
        <Route
          path="/social"
          element={
            <Guarded>
              <Social />
            </Guarded>
          }
        />
        <Route
          path="/freistellen"
          element={
            <Guarded>
              <Cutout />
            </Guarded>
          }
        />
        <Route
          path="/einstellungen/*"
          element={
            <Guarded>
              <Settings />
            </Guarded>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Palette />
      <InstallDialogHost />
    </div>
  );
}

function RedirectStart() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate("/start", { replace: true });
  }, [navigate]);
  return (
    <Link to="/start" className="sr-only">
      {t.nav.start}
    </Link>
  );
}
