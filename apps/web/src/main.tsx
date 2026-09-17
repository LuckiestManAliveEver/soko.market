import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./AppRouter";
import { ConnectivityIndicator } from "./ConnectivityIndicator";
import { runDeploymentRecoveryStartupChecks } from "./lazy-module-recovery";
import { PerformancePanel } from "./PerformancePanel";
import { recordReadiness, startPerformanceMonitoring } from "./performance";
import { registerAppServiceWorker } from "./service-worker";
import "./styles.css";
import "./home-reference.css";

function App() {
  useEffect(() => {
    startPerformanceMonitoring();
    recordReadiness("app-shell");
    registerAppServiceWorker();
    runDeploymentRecoveryStartupChecks();
  }, []);

  return (
    <>
      <AppRouter />
      <ConnectivityIndicator />
      <PerformancePanel />
    </>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element not found.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
