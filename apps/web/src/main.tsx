import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Surface } from "@soko/ui";
import "./styles.css";

function App() {
  return (
    <Surface title="Soko.market">
      <p>Engineering foundation is active.</p>
    </Surface>
  );
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
