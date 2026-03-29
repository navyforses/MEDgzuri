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
        <div className="mt-10">
          <PricingCTA size="lg" />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-primary-200">
          <span>🌍 15+ Countries</span>
          <span>🏥 Medical & Rehabilitation</span>
          <span>🚀 Startup Funding</span>
          <span>📅 Updated Monthly</span>
        </div>
      </div>
    </section>
  );
}
