import Link from "next/link";
import PricingCTA from "./PricingCTA";

export default function Hero() {
  return (
    <section
      className="relative text-white"
      style={{
        background:
          "linear-gradient(135deg, #1B4F72 0%, #2C3E50 50%, #1A202C 100%)",
      }}
    >
      <div className="mx-auto max-w-[1400px] px-6 pb-20 pt-28 text-center sm:pb-28 sm:pt-36">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm">
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full"
            style={{ background: "#2ECC71" }}
          />
          Updated Monthly
        </div>

        <h1
          className="mx-auto max-w-4xl font-extrabold tracking-[-0.02em]"
          style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)", lineHeight: "1.2" }}
        >
          Find Grants for Medical Treatment
          <br className="hidden sm:block" />
          <span style={{ color: "#2ECC71" }}> & Startups</span> — Worldwide
        </h1>

        <p
          className="mx-auto mt-6 max-w-2xl"
          style={{
            fontSize: "1.125rem",
            lineHeight: "1.7",
            color: "rgba(255, 255, 255, 0.7)",
          }}
        >
          Curated database of 50+ grants for individuals, families, and
          founders. Medical treatment, rehabilitation, rare diseases, and startup
          funding.
        </p>

        {/* CTA buttons */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <PricingCTA size="lg" />
          <Link
            href="/grants"
            className="inline-block rounded-full border-[1.5px] border-white/40 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-white hover:bg-white/10"
          >
            Browse Grants Free
          </Link>
        </div>

        {/* Glass stats */}
        <div className="mx-auto mt-14 flex max-w-md flex-wrap items-center justify-center gap-4">
          {[
            { value: "30+", label: "Grants" },
            { value: "6", label: "Countries" },
            { value: "5", label: "Categories" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[12px] px-6 py-3 text-center backdrop-blur-md"
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
              }}
            >
              <div className="text-xl font-bold">{stat.value}</div>
              <div
                className="text-xs font-medium"
                style={{ color: "rgba(255, 255, 255, 0.6)" }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
