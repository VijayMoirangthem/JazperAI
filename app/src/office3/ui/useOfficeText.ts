"use client";

import { useEffect, useState } from "react";
import { officeText, type OfficeTextKey } from "../core/i18n";

/** Re-renders visible local UI when the persisted language preference changes. */
export const useOfficeText = () => {
  const [, setVersion] = useState(0);
  useEffect(() => { const refresh = () => setVersion(value => value + 1); window.addEventListener("office3:view-settings", refresh); return () => window.removeEventListener("office3:view-settings", refresh); }, []);
  return (key: OfficeTextKey, values?: Record<string, string | number>) => officeText(key, values);
};
