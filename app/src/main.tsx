import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { ToastProvider } from "@/components/ToastProvider";
import "./index.css";
import { loadPerf, setPerf, getPerf } from "@/lib/perfRuntime";

try { if (!localStorage.getItem("jasper.setupDone") && !window.location.hash) window.location.hash = "setup"; } catch { /* storage unavailable */ }

// Performance Settings: apply the cached values to the first paint, then refresh them from the backend.
setPerf(getPerf());
void loadPerf(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000");

// No <StrictMode>: page.tsx's one-time view init (didInit ref) is not StrictMode-safe and would reset the hash route.
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <Home />
  </ToastProvider>,
);
