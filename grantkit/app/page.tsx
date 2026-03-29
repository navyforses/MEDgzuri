import Link from "next/link";
import Hero from "@/components/Hero";
import GrantCard from "@/components/GrantCard";
import PricingCTA from "@/components/PricingCTA";
import FAQAccordion from "@/components/FAQAccordion";
import ScrollReveal from "@/components/ScrollReveal";
import grants from "@/data/grants.json";

const previewGrants = grants.filter((g) => g.featured).slice(0, 5);

const faqItems = [
  {
    q: "How often is it updated?",
    a: "Monthly. We review every grant, add new ones, and update deadlines. Members are notified of updates.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, you can cancel your membership anytime through Gumroad. No questions asked.",
  },
  {
    q: "What countries are covered?",
    a: "US, EU (France, Germany, Netherlands, and more), UK, Georgia, Canada, and Australia. We're expanding coverage every month.",
  },
  {
    q: "Is this for organizations or individuals?",
    a: "Both. We include grants for individual patients and families, as well as early-stage startups and research organizations.",
  },
];

export default function Home() {
  return (
    <main>
      <Hero />

      {/* Problem Section */}
      <ScrollReveal>
        <section style={{ background: "#F8FAFC" }} className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1400px] px-6">
            <p
              className="text-center text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1B4F72" }}
            >
              The Problem
            </p>
            <h2
              className="mt-3 text-center font-extrabold tracking-[-0.02em]"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#1A202C",
              }}
            >
              Grant information is scattered, outdated, and hard to find
            </h2>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {[
                {
                  icon: "\u{1F50D}",
                  text: "Hours of searching across dozens of websites",
                },
                {
                  icon: "\u{1F310}",
                  text: "Language barriers and confusing eligibility rules",
                },
                {
                  icon: "\u23F0",
                  text: "Missing deadlines because nobody told you in time",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="group rounded-[16px] bg-white p-8 text-center transition-all duration-300 hover:-translate-y-1.5"
                  style={{
                    border: "1px solid #E2E8F0",
                    boxShadow: "0 1px 3px rgba(26, 32, 44, 0.06)",
                  }}
                >
                  <div
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-[12px] text-2xl"
                    style={{ background: "rgba(27, 79, 114, 0.08)" }}
                  >
                    {item.icon}
                  </div>
                  <p
                    className="mt-5 text-base leading-relaxed"
                    style={{ color: "rgba(26, 32, 44, 0.6)" }}
                  >
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* What You Get */}
      <ScrollReveal>
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1400px] px-6">
            <p
              className="text-center text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1B4F72" }}
            >
              Features
            </p>
            <h2
              className="mt-3 text-center font-extrabold tracking-[-0.02em]"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#1A202C",
              }}
            >
              What you get with GrantKit
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: "\u{1F4CB}",
                  title: "Curated Grants",
                  desc: "Organized by category with clear eligibility info",
                },
                {
                  icon: "\u{1F517}",
                  title: "Direct Links",
                  desc: "One-click access to official application pages",
                },
                {
                  icon: "\u{1F504}",
                  title: "Monthly Updates",
                  desc: "New grants added and deadlines refreshed every month",
                },
                {
                  icon: "\u{1F3F7}\uFE0F",
                  title: "5 Categories",
                  desc: "Medical, Rehabilitation, Rare Disease, Pediatric, Startup",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="group relative overflow-hidden rounded-[16px] bg-white p-6 text-center transition-all duration-300 hover:-translate-y-1.5"
                  style={{
                    border: "1px solid #E2E8F0",
                    boxShadow: "0 1px 3px rgba(26, 32, 44, 0.06)",
                  }}
                >
                  {/* Top accent on hover */}
                  <div
                    className="absolute left-0 right-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
                    style={{ background: "#1B4F72" }}
                  />
                  <div
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-[12px] text-2xl"
                    style={{ background: "rgba(27, 79, 114, 0.08)" }}
                  >
                    {item.icon}
                  </div>
                  <h3
                    className="mt-4 text-base font-semibold"
                    style={{ color: "#1A202C" }}
                  >
                    {item.title}
                  </h3>
                  <p
                    className="mt-2 text-[0.875rem] leading-relaxed"
                    style={{ color: "rgba(26, 32, 44, 0.6)" }}
                  >
                    {item.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* Preview Section */}
      <ScrollReveal>
        <section style={{ background: "#F8FAFC" }} className="py-16 sm:py-20">
          <div className="mx-auto max-w-[1400px] px-6">
            <p
              className="text-center text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1B4F72" }}
            >
              Preview
            </p>
            <h2
              className="mt-3 text-center font-extrabold tracking-[-0.02em]"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#1A202C",
              }}
            >
              Free Sample Grants
            </h2>
            <p
              className="mt-3 text-center text-base"
              style={{ color: "rgba(26, 32, 44, 0.6)" }}
            >
              See the quality of our curated data before subscribing
            </p>

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {previewGrants.map((grant) => (
                <GrantCard key={grant.id} grant={grant} />
              ))}
            </div>

            {/* Blurred / locked section */}
            <div className="relative mt-8">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-64 rounded-[16px] bg-white p-6 blur-sm"
                    style={{ border: "1px solid #E2E8F0" }}
                  >
                    <div className="h-4 w-3/4 rounded bg-gray-200" />
                    <div className="mt-3 h-3 w-1/2 rounded bg-gray-100" />
                    <div className="mt-6 h-3 w-full rounded bg-gray-100" />
                    <div className="mt-2 h-3 w-full rounded bg-gray-100" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-gray-100" />
                    <div className="mt-6 h-8 w-full rounded bg-gray-200" />
                  </div>
                ))}
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p
                  className="mb-4 text-lg font-semibold"
                  style={{ color: "#1A202C" }}
                >
                  50+ more grants available for members
                </p>
                <PricingCTA label="Unlock All Grants — $9/month" />
              </div>
            </div>

            <div className="mt-8 text-center">
              <Link
                href="/grants"
                className="text-[0.875rem] font-medium transition-colors duration-200 hover:underline"
                style={{ color: "#1B4F72" }}
              >
                View All Grants &rarr;
              </Link>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* FAQ */}
      <ScrollReveal>
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-6">
            <p
              className="text-center text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1B4F72" }}
            >
              FAQ
            </p>
            <h2
              className="mt-3 text-center font-extrabold tracking-[-0.02em]"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#1A202C",
              }}
            >
              Frequently Asked Questions
            </h2>
            <div className="mt-10">
              <FAQAccordion items={faqItems} />
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* Final CTA */}
      <section
        className="py-16 text-center text-white"
        style={{
          background:
            "linear-gradient(135deg, #1B4F72 0%, #2C3E50 50%, #1A202C 100%)",
        }}
      >
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-extrabold tracking-[-0.02em]">
            Stop searching. Start applying.
          </h2>
          <p
            className="mt-4 text-lg"
            style={{ color: "rgba(255, 255, 255, 0.7)" }}
          >
            Get instant access to our full curated grant database.
          </p>
          <div className="mt-8">
            <PricingCTA size="lg" />
          </div>
        </div>
      </section>
    </main>
  );
}
