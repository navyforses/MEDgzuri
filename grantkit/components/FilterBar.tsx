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
        {/* Category tabs - MedGzuri tab style */}
        <div
          className="flex gap-1 overflow-x-auto rounded-[16px] p-1 scrollbar-hide"
          style={{
            background: "white",
            border: "1px solid #E2E8F0",
            boxShadow: "0 1px 3px rgba(26, 32, 44, 0.06)",
          }}
        >
          {categories.map((cat) => (
            <button
              key={cat.value}
              onClick={() => onCategoryChange(cat.value)}
              className="flex-shrink-0 rounded-[12px] px-4 py-2 text-[0.8125rem] font-medium transition-all duration-200"
              style={
                activeCategory === cat.value
                  ? {
                      background: "#1B4F72",
                      color: "white",
                      boxShadow: "0 4px 12px rgba(26, 32, 44, 0.08)",
                    }
                  : {
                      background: "transparent",
                      color: "#1A202C",
                    }
              }
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <select
            value={activeCountry}
            onChange={(e) => onCountryChange(e.target.value)}
            className="rounded-[12px] bg-[#F8FAFC] px-4 py-2 text-[0.875rem] transition-all duration-200"
            style={{
              border: "1.5px solid #E2E8F0",
              color: "#1A202C",
              outline: "none",
            }}
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
              className="flex-shrink-0 rounded-[8px] px-3 py-2 text-[0.8125rem] font-medium transition-all duration-200"
              style={{ color: "#1B4F72" }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <p className="text-[0.8125rem]" style={{ color: "rgba(26, 32, 44, 0.4)" }}>
        Showing{" "}
        <span className="font-medium" style={{ color: "#1A202C" }}>
          {filteredCount}
        </span>{" "}
        of {totalCount} grants
      </p>
    </div>
  );
}
