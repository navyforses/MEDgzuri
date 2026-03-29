import Link from "next/link";
import Hero from "@/components/Hero";
import GrantCard from "@/components/GrantCard";
import PricingCTA from "@/components/PricingCTA";
import Footer from "@/components/Footer";
import grants from "@/data/grants.json";

const previewGrants = grants.filter((g) => g.featured).slice(0, 5);

export default function Home() {
  return (
    <main>
      <Hero />

      {/* Problem Section */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Grant information is scattered, outdated, and hard to find
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: "🔍",
                text: "Hours of searching across dozens of websites",
              },
              {
                icon: "🌐",
                text: "Language barriers and confusing eligibility rules",
              },
              {
                icon: "⏰",
                text: "Missing deadlines because nobody told you in time",
              },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <div className="text-4xl">{item.icon}</div>
                <p className="mt-4 text-lg text-gray-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What You Get */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            What you get with GrantKit
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: "📋",
                title: "Curated Grants",
                desc: "Organized by category with clear eligibility info",
              },
              {
                icon: "🔗",
                title: "Direct Links",
                desc: "One-click access to official application pages",
              },
              {
                icon: "🔄",
                title: "Monthly Updates",
                desc: "New grants added and deadlines refreshed every month",
              },
              {
                icon: "🏷️",
                title: "5 Categories",
                desc: "Medical, Rehabilitation, Rare Disease, Pediatric, Startup",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-gray-200 p-6 text-center"
              >
                <div className="text-3xl">{item.icon}</div>
                <h3 className="mt-3 font-semibold text-gray-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Preview Section */}
      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Preview — Free Sample Grants
          </h2>
          <p className="mt-3 text-center text-gray-600">
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
                  className="h-64 rounded-xl border border-gray-200 bg-white p-6 blur-sm"
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
              <p className="mb-4 text-lg font-semibold text-gray-800">
                50+ more grants available for members
              </p>
              <PricingCTA label="Unlock All Grants — $9/month" />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Frequently Asked Questions
          </h2>
          <div className="mt-10 space-y-6">
            {[
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
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900">{item.q}</h3>
                <p className="mt-2 text-gray-600">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-primary-700 py-16 text-center text-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold">
            Stop searching. Start applying.
          </h2>
          <p className="mt-4 text-lg text-primary-200">
            Get instant access to our full curated grant database.
          </p>
          <div className="mt-8">
            <PricingCTA size="lg" />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
