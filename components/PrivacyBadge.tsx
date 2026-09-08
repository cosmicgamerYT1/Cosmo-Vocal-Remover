import { ShieldCheck } from "lucide-react";

export default function PrivacyBadge({ className = "" }: { className?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-white/60 ${className}`}
    >
      <ShieldCheck size={14} className="text-accent-400 shrink-0" />
      Your media stays on your device. Processing happens in your browser.
    </div>
  );
}
