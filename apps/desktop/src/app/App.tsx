import { lazy, Suspense } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TipProvider } from "../ui/Tip";
import { ErrorBoundary } from "./ErrorBoundary";
import { ONBOARDING_PATH } from "./modules";
import { Session } from "./Session";
import { Shell } from "./Shell";

const Onboarding = lazy(() => import("../features/onboarding/Onboarding"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: false, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <HashRouter>
          <Session />
          <ErrorBoundary>
            <Routes>
              <Route
                path={ONBOARDING_PATH}
                element={
                  <Suspense fallback={null}>
                    <Onboarding />
                  </Suspense>
                }
              />
              <Route path="*" element={<Shell />} />
            </Routes>
          </ErrorBoundary>
        </HashRouter>
      </TipProvider>
    </QueryClientProvider>
  );
}
