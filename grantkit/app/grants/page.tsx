"use client";

import { useState, useMemo } from "react";
import GrantCard from "@/components/GrantCard";
import FilterBar from "@/components/FilterBar";
import Footer from "@/components/Footer";
import grants from "@/data/grants.json";

const countryMap: Record<string, { flag: string; name: string }> = {
  US: { flag: "🇺🇸", name: "United States" },
  FR: { flag: "🇫🇷", name: "France" },
  DE: { flag: "🇩🇪", name: "Germany" },
  GB: { flag: "🇬🇧", name: "United Kingdom" },
  GE: { flag: "🇬🇪", name: "Georgia" },
  EU: { flag: "🇪🇺", name: "European Union" },
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

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Member Banner */}
      <div className="bg-primary-700 px-4 py-3 text-center text-sm text-white">
        This page is for GrantKit members. Not a member yet?{" "}
        <a
          href="https://YOURUSERNAME.gumroad.com/l/grantkit"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline hover:text-primary-200"
        >
          Subscribe on Gumroad →
        </a>
      </div>

      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <a href="/" className="text-xl font-bold text-primary-700">
            GrantKit
          </a>
          <a
            href="https://YOURUSERNAME.gumroad.com/l/grantkit"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            Get Access
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Grants Directory</h1>
        <p className="mt-2 text-gray-600">
          {grants.length} grants across {Object.keys(countryMap).length}{" "}
          countries and 5 categories
        </p>

        <div className="mt-6">
          <FilterBar
            activeCategory={category}
            activeCountry={country}
            countries={countries}
            onCategoryChange={setCategory}
            onCountryChange={setCountry}
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
            <p className="text-lg text-gray-500">
              No grants match your filters. Try a different combination.
            </p>
          </div>
        )}
      </div>

      <Footer />
    </main>
  );
}
