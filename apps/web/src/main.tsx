import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppRouter } from "./AppRouter";
import { startPerformanceMonitoring } from "./performance";
import { registerAppServiceWorker } from "./service-worker";
import "./styles.css";

function App() {
  useEffect(() => {
    startPerformanceMonitoring();
    registerAppServiceWorker();
  }, []);

  return <AppRouter />;
}

const root = document.getElementById("root");
if (root === null) throw new Error("Root element not found.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
