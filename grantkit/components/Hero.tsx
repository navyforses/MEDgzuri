import Link from "next/link";
import PricingCTA from "./PricingCTA";

export default function Hero() {
  return (
    <section className="bg-primary-700 text-white">
      <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Find Grants for Medical Treatment
          <br className="hidden sm:block" /> & Startups — Worldwide
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-primary-200 sm:text-xl">
          Curated database of 50+ grants for individuals, families, and
          founders. Updated monthly.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <PricingCTA size="lg" />
          <Link
            href="/grants"
            className="inline-block rounded-lg border-2 border-white/30 px-8 py-4 text-lg font-semibold text-white transition-colors hover:border-white hover:bg-white/10"
          >
            Browse Grants Free
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {[
            { value: "30+", label: "Grants" },
            { value: "6", label: "Countries" },
            { value: "5", label: "Categories" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-sm text-primary-200">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Trust indicators */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-primary-200">
          <span>&#127758; 15+ Countries</span>
          <span>&#127973; Medical & Rehabilitation</span>
          <span>&#128640; Startup Funding</span>
          <span>&#128197; Updated Monthly</span>
        </div>
      </div>
    </section>
  );
}
