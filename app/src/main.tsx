import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { ToastProvider } from "@/components/ToastProvider";
import "./index.css";

try { if (!localStorage.getItem("jasper.setupDone") && !window.location.hash) window.location.hash = "setup"; } catch { /* storage unavailable */ }

// No <StrictMode>: page.tsx's one-time view init (didInit ref) is not StrictMode-safe and would reset the hash route.
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <Home />
  </ToastProvider>,
);
