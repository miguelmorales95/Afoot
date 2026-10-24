import AdUnit from "./AdUnit";
import { adProvider, trackingFree } from "@/lib/ads";

// Right-side ad rail (desktop only — keeps small/old phones light).
// `area`: the launch area being browsed (see areaForLocation), for area sponsors.
export default function AdRail({ area = null }: { area?: string | null }) {
  if (adProvider() === "none") return null;
  return (
    <aside className="hidden lg:block" aria-label="Advertisements">
      <div className="sticky top-20 space-y-4">
        <AdUnit index={0} area={area} className="min-h-[200px]" slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_RAIL} />
        <AdUnit index={1} area={area} className="min-h-[200px]" />
        <p className="px-1 text-[10px] leading-relaxed text-white/20">
          {trackingFree() ? "Ads keep Afoot free. No cookies, no tracking." : "Ads keep Afoot free. Local sponsors first; no personalized ads."}
        </p>
      </div>
    </aside>
  );
}
