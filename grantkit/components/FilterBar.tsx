"use client";

interface FilterBarProps {
  activeCategory: string;
  activeCountry: string;
  countries: { code: string; flag: string; name: string }[];
  onCategoryChange: (category: string) => void;
  onCountryChange: (country: string) => void;
}

const categories = [
  { value: "all", label: "All" },
  { value: "medical-treatment", label: "Medical Treatment" },
  { value: "rehabilitation", label: "Rehabilitation" },
  { value: "rare-disease", label: "Rare Disease" },
  { value: "pediatric", label: "Pediatric" },
  { value: "startup", label: "Startup" },
];

export default function FilterBar({
  activeCategory,
  activeCountry,
  countries,
  onCategoryChange,
  onCountryChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => onCategoryChange(cat.value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              activeCategory === cat.value
                ? "bg-primary-700 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <select
        value={activeCountry}
        onChange={(e) => onCountryChange(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="all">All Countries</option>
        {countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
