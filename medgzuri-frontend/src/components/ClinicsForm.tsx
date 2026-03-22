"use client";

import { useState } from "react";
import { ClinicsData } from "@/types/api";
import CheckboxGroup from "./CheckboxGroup";

const countryOptions = [
  { label: "გერმანია", value: "germany" },
  { label: "თურქეთი", value: "turkey" },
  { label: "ისრაელი", value: "israel" },
  { label: "აშშ", value: "usa" },
  { label: "ესპანეთი", value: "spain" },
  { label: "ინდოეთი", value: "india" },
];

const budgetOptions = [
  { label: "არ მაქვს პრეფერენცია", value: "" },
  { label: "5,000€-მდე", value: "low" },
  { label: "5,000€ - 20,000€", value: "mid" },
  { label: "20,000€ - 50,000€", value: "high" },
  { label: "50,000€+", value: "premium" },
];

const langOptions = [
  { label: "ნებისმიერი", value: "any" },
  { label: "ინგლისური", value: "english" },
  { label: "რუსული", value: "russian" },
  { label: "თურქული", value: "turkish" },
];

interface Props {
  onSubmit: (data: ClinicsData) => void;
  isLoading: boolean;
}

export default function ClinicsForm({ onSubmit, isLoading }: Props) {
  const [diagnosis, setDiagnosis] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [budget, setBudget] = useState("");
  const [language, setLanguage] = useState("any");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!diagnosis.trim()) {
      setError("გთხოვთ მიუთითოთ დიაგნოზი ან საჭირო მკურნალობა.");
      return;
    }
    if (diagnosis.length > 500) {
      setError("დიაგნოზი არ უნდა აღემატებოდეს 500 სიმბოლოს.");
      return;
    }
    setError("");
    onSubmit({
      diagnosis: diagnosis.trim(),
      countries,
      budget,
      language,
      notes: notes.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Diagnosis */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">
          დიაგნოზი ან საჭირო მკურნალობა <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={diagnosis}
          onChange={(e) => setDiagnosis(e.target.value)}
          placeholder="მაგ: თავის ტვინის სიმსივნე, მუხლის ენდოპროთეზირება, IVF..."
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
        <div className="text-xs text-text-muted text-right mt-1">{diagnosis.length}/500</div>
      </div>

      {/* Countries */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">სასურველი ქვეყნები</label>
        <CheckboxGroup options={countryOptions} selected={countries} onChange={setCountries} />
      </div>

      {/* Budget + Language */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">ბიუჯეტის დიაპაზონი</label>
          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          >
            {budgetOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">ენის პრეფერენცია</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          >
            {langOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">დამატებითი მოთხოვნები</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="მაგ: გჭირდებათ თარჯიმანი, გსურთ ონლაინ კონსულტაცია..."
          maxLength={1000}
          rows={3}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm resize-y
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
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
            "კლინიკების ძიება"
          )}
        </button>
        <p className="text-xs text-text-muted text-center mt-2">ფასები ინფორმაციული ხასიათისაა და შეიძლება განსხვავდებოდეს</p>
      </div>
    </form>
  );
}
