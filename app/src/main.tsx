import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { ToastProvider } from "@/components/ToastProvider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <Home />
    </ToastProvider>
  </StrictMode>,
);
