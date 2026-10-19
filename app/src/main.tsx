import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { ToastProvider } from "@/components/ToastProvider";
import "./index.css";

// No <StrictMode>: page.tsx's one-time view init (didInit ref) is not StrictMode-safe and would reset the hash route.
createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <Home />
  </ToastProvider>,
);
