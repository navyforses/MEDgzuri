"use client";

import { useState } from "react";
import { ResearchData } from "@/types/api";
import CheckboxGroup from "./CheckboxGroup";

const ageOptions = [
  { label: "", value: "" },
  { label: "ახალშობილი (0-28 დღე)", value: "neonate" },
  { label: "ჩვილი (1-12 თვე)", value: "infant" },
  { label: "ბავშვი (1-12 წელი)", value: "child" },
  { label: "მოზარდი (13-17 წელი)", value: "adolescent" },
  { label: "ზრდასრული (18-64)", value: "adult" },
  { label: "ხანდაზმული (65+)", value: "elderly" },
];

const typeOptions = [
  { label: "ყველა ტიპი", value: "all" },
  { label: "კლინიკური კვლევა", value: "clinical_trial" },
  { label: "სისტემატური მიმოხილვა", value: "systematic_review" },
  { label: "შემთხვევის კვლევა", value: "case_study" },
  { label: "ერთობლივი ანალიზი", value: "meta_analysis" },
];

const regionOptions = [
  { label: "მთელი მსოფლიო", value: "global" },
  { label: "ევროკავშირი", value: "eu" },
  { label: "აშშ", value: "us" },
  { label: "თურქეთი", value: "turkey" },
  { label: "ისრაელი", value: "israel" },
];

interface Props {
  onSubmit: (data: ResearchData) => void;
  isLoading: boolean;
}

export default function ResearchForm({ onSubmit, isLoading }: Props) {
  const [diagnosis, setDiagnosis] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [researchType, setResearchType] = useState("all");
  const [context, setContext] = useState("");
  const [regions, setRegions] = useState<string[]>(["global"]);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!diagnosis.trim()) {
      setError("გთხოვთ მიუთითოთ დიაგნოზი ან სამედიცინო მდგომარეობა.");
      return;
    }
    if (diagnosis.length > 500) {
      setError("დიაგნოზი არ უნდა აღემატებოდეს 500 სიმბოლოს.");
      return;
    }
    setError("");
    onSubmit({ diagnosis: diagnosis.trim(), ageGroup, researchType, context: context.trim(), regions });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Diagnosis */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">
          დიაგნოზი ან სამედიცინო მდგომარეობა <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
          placeholder="მაგ: ჰიპოქსიურ-იშემიური ენცეფალოპათია, ტიპი 2 დიაბეტი, ფილტვის კიბო..."
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
        <div className="text-xs text-text-muted text-right mt-1">{diagnosis.length}/500</div>
      </div>

      {/* Age + Type row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">ასაკობრივი ჯგუფი</label>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          >
            {ageOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label || "(არასავალდებულო)"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">კვლევის ტიპი</label>
          <select
            value={researchType}
            onChange={(e) => setResearchType(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Context */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">დამატებითი კონტექსტი</label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="აღწერეთ დამატებითი დეტალები: რა მკურნალობა იყო ცდილი..."
          maxLength={2000}
          rows={3}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm resize-y
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
      </div>

      {/* Regions */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">ძიების გეოგრაფია</label>
        <CheckboxGroup options={regionOptions} selected={regions} onChange={setRegions} />
      </div>

      {/* Error */}
      {error && (
        <div className="text-danger text-sm bg-danger/5 px-4 py-2 rounded-lg">{error}</div>
      )}

      {/* Submit */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3.5 bg-teal text-white font-semibold rounded-xl
                     hover:bg-teal-hover active:scale-[0.98] transition-all shadow-md
                     disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              მიმდინარეობს...
            </>
          ) : (
            "ძიების დაწყება"
          )}
        </button>
        <p className="text-xs text-text-muted text-center mt-2">თქვენი მონაცემები დაცულია და არ ინახება</p>
      </div>
    </form>
  );
}
