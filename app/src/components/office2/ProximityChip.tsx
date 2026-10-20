"use client";

import { MessageCircle } from "lucide-react";

export function ProximityChip({ names, onTalk }: { names: { slug: string; name: string }[]; onTalk: (slug: string) => void }) {
  if (!names.length) return null;
  const label = names.length === 1 ? `Talk to ${names[0].name}` : `Talk to ${names[0].name}, ${names[1].name}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
  return (
    <button data-testid="office2-chip" onClick={() => onTalk(names[0].slug)}
      className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium shadow-lg ring-1 ring-white/30 hover:bg-blue-500">
      <MessageCircle size={16} />{label}
    </button>
  );
}
