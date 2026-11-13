import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ClavierErrorBoundary } from "./ui/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClavierErrorBoundary>
      <App />
    </ClavierErrorBoundary>
  </StrictMode>,
);
