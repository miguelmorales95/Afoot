import AdUnit from "./AdUnit";
import { adProvider } from "@/lib/ads";

// Right-side ad rail (desktop only — keeps small/old phones light).
export default function AdRail() {
  if (adProvider() === "none") return null;
  return (
    <aside className="hidden lg:block" aria-label="Advertisements">
      <div className="sticky top-20 space-y-4">
        <AdUnit index={0} className="min-h-[200px]" slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_RAIL} />
        <AdUnit index={1} className="min-h-[200px]" />
        <p className="px-1 text-[10px] leading-relaxed text-white/20">
          Ads keep WhatsUp free. No cookies, no tracking.
        </p>
      </div>
    </aside>
  );
}
