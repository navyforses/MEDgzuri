import { Grant } from "@/lib/types";
import { categoryLabels, categoryColors } from "@/lib/constants";

const categoryAccentColors: Record<string, string> = {
  "medical-treatment": "#1B4F72",
  rehabilitation: "#7C3AED",
  "rare-disease": "#E11D48",
  pediatric: "#D97706",
  startup: "#059669",
};

export default function GrantCard({ grant }: { grant: Grant }) {
  const accentColor =
    categoryAccentColors[grant.category] || "#1B4F72";

  return (
    <div className="grant-card group relative flex flex-col overflow-hidden rounded-[16px] bg-white transition-all duration-300 hover:-translate-y-1">
      {/* Top accent bar */}
      <div
        className="h-[3px] origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
        style={{ background: accentColor }}
      />

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-3 flex items-start gap-3">
          <div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[12px] text-xl"
            style={{ background: "rgba(27, 79, 114, 0.08)" }}
          >
            {grant.countryFlag}
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="text-base font-semibold leading-tight"
              style={{ color: "#1A202C" }}
            >
              {grant.name}
            </h3>
            <p
              className="mt-1 text-[0.8125rem]"
              style={{ color: "rgba(26, 32, 44, 0.6)" }}
            >
              {grant.organization}
            </p>
          </div>
        </div>

        <div className="mb-3">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryColors[grant.category] || "bg-gray-100 text-gray-800"}`}
          >
            {categoryLabels[grant.category] || grant.category}
          </span>
        </div>

        <p
          className="mb-4 flex-1 text-[0.875rem] leading-relaxed"
          style={{ color: "rgba(26, 32, 44, 0.6)" }}
        >
          {grant.description}
        </p>

        <div
          className="space-y-2 pt-4 text-[0.875rem]"
          style={{ borderTop: "1px solid #E2E8F0" }}
        >
          <div className="flex justify-between">
            <span style={{ color: "rgba(26, 32, 44, 0.4)" }}>Amount</span>
            <span className="font-medium" style={{ color: "#1A202C" }}>
              {grant.amount}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "rgba(26, 32, 44, 0.4)" }}>Deadline</span>
            <span className="font-medium" style={{ color: "#1A202C" }}>
              {grant.deadline}
            </span>
          </div>
          <div>
            <span style={{ color: "rgba(26, 32, 44, 0.4)" }}>Eligibility</span>
            <p className="mt-1" style={{ color: "#1A202C" }}>
              {grant.eligibility}
            </p>
          </div>
        </div>

        <a
          href={grant.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 block rounded-full py-2.5 text-center text-[0.875rem] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5"
          style={{
            background: "#1B4F72",
            boxShadow: "0 2px 8px rgba(27, 79, 114, 0.2)",
          }}
        >
          Apply &rarr;
        </a>
      </div>
    </div>
  );
}
