"use client";

interface FilterBarProps {
  activeCategory: string;
  activeCountry: string;
  countries: { code: string; flag: string; name: string }[];
  filteredCount: number;
  totalCount: number;
  onCategoryChange: (category: string) => void;
  onCountryChange: (country: string) => void;
  onReset: () => void;
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
  filteredCount,
  totalCount,
  onCategoryChange,
  onCountryChange,
  onReset,
}: FilterBarProps) {
  const hasActiveFilters = activeCategory !== "all" || activeCountry !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => onCategoryChange(cat.value)}
              className={`flex-shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeCategory === cat.value
                  ? "bg-primary-700 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
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

          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="flex-shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Showing{" "}
        <span className="font-medium text-gray-700">{filteredCount}</span> of{" "}
        {totalCount} grants
      </p>
    </div>
  );
}
