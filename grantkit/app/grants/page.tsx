"use client";

import { useState, useMemo } from "react";
import GrantCard from "@/components/GrantCard";
import FilterBar from "@/components/FilterBar";
import PricingCTA from "@/components/PricingCTA";
import grants from "@/data/grants.json";

const countryMap: Record<string, { flag: string; name: string }> = {
  US: { flag: "\u{1F1FA}\u{1F1F8}", name: "United States" },
  FR: { flag: "\u{1F1EB}\u{1F1F7}", name: "France" },
  DE: { flag: "\u{1F1E9}\u{1F1EA}", name: "Germany" },
  GB: { flag: "\u{1F1EC}\u{1F1E7}", name: "United Kingdom" },
  GE: { flag: "\u{1F1EC}\u{1F1EA}", name: "Georgia" },
  EU: { flag: "\u{1F1EA}\u{1F1FA}", name: "European Union" },
};

const countries = Object.entries(countryMap).map(([code, info]) => ({
  code,
  ...info,
}));

export default function GrantsPage() {
  const [category, setCategory] = useState("all");
  const [country, setCountry] = useState("all");

  const filtered = useMemo(() => {
    return grants.filter((g) => {
      if (category !== "all" && g.category !== category) return false;
      if (country !== "all" && g.country !== country) return false;
      return true;
    });
  }, [category, country]);

  const hasActiveFilters = category !== "all" || country !== "all";

  const handleReset = () => {
    setCategory("all");
    setCountry("all");
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Grants Directory</h1>
        <p className="mt-2 text-gray-600">
          Browse {grants.length} grants across{" "}
          {Object.keys(countryMap).length} countries and 5 categories
        </p>

        <div className="mt-6">
          <FilterBar
            activeCategory={category}
            activeCountry={country}
            countries={countries}
            filteredCount={filtered.length}
            totalCount={grants.length}
            onCategoryChange={setCategory}
            onCountryChange={setCountry}
            onReset={handleReset}
          />
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((grant, i) => (
            <div
              key={grant.id}
              className="animate-fade-in-up opacity-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <GrantCard grant={grant} />
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 text-5xl">
              <span role="img" aria-label="no results">&#128269;</span>
            </div>
            <p className="text-lg font-medium text-gray-700">
              No grants match your filters
            </p>
            <p className="mt-1 text-gray-500">
              Try a different category or country combination
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleReset}
                className="mt-4 rounded-lg bg-primary-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <section className="bg-primary-700 py-12 text-center text-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-2xl font-bold">
            Want the full curated database?
          </h2>
          <p className="mt-3 text-primary-200">
            Get access to all grants with monthly updates and new additions.
          </p>
          <div className="mt-6">
            <PricingCTA size="lg" />
          </div>
        </div>
      </section>
    </main>
  );
}
