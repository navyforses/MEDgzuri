interface Grant {
  id: string;
  name: string;
  organization: string;
  country: string;
  countryFlag: string;
  category: string;
  amount: string;
  eligibility: string;
  deadline: string;
  url: string;
  description: string;
  featured: boolean;
}

const categoryLabels: Record<string, string> = {
  "medical-treatment": "Medical Treatment",
  rehabilitation: "Rehabilitation",
  "rare-disease": "Rare Disease",
  pediatric: "Pediatric",
  startup: "Startup",
};

const categoryColors: Record<string, string> = {
  "medical-treatment": "bg-blue-100 text-blue-800",
  rehabilitation: "bg-purple-100 text-purple-800",
  "rare-disease": "bg-rose-100 text-rose-800",
  pediatric: "bg-amber-100 text-amber-800",
  startup: "bg-emerald-100 text-emerald-800",
};

export default function GrantCard({ grant }: { grant: Grant }) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl" role="img" aria-label={grant.country}>
            {grant.countryFlag}
          </span>
          <h3 className="text-lg font-semibold text-gray-900">{grant.name}</h3>
        </div>
      </div>

      <p className="mb-3 text-sm text-gray-500">{grant.organization}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryColors[grant.category] || "bg-gray-100 text-gray-800"}`}
        >
          {categoryLabels[grant.category] || grant.category}
        </span>
      </div>

      <p className="mb-4 flex-1 text-sm text-gray-600">{grant.description}</p>

      <div className="space-y-2 border-t border-gray-100 pt-4 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Amount</span>
          <span className="font-medium text-gray-900">{grant.amount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Deadline</span>
          <span className="font-medium text-gray-900">{grant.deadline}</span>
        </div>
        <div>
          <span className="text-gray-500">Eligibility</span>
          <p className="mt-1 text-gray-700">{grant.eligibility}</p>
        </div>
      </div>

      <a
        href={grant.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block rounded-lg bg-primary-700 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-800"
      >
        Apply →
      </a>
    </div>
  );
}
