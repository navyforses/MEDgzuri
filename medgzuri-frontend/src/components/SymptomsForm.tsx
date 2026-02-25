"use client";

import { useState } from "react";
import { SymptomsData } from "@/types/api";

const sexOptions = [
  { label: "(არასავალდებულო)", value: "" },
  { label: "მამრობითი", value: "male" },
  { label: "მდედრობითი", value: "female" },
];

interface Props {
  onSubmit: (data: SymptomsData) => void;
  isLoading: boolean;
}

export default function SymptomsForm({ onSubmit, isLoading }: Props) {
  const [symptoms, setSymptoms] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [existing, setExisting] = useState("");
  const [meds, setMeds] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptoms.trim()) {
      setError("გთხოვთ მიუთითოთ სიმპტომების აღწერა.");
      return;
    }
    if (symptoms.length > 2000) {
      setError("სიმპტომების აღწერა არ უნდა აღემატებოდეს 2000 სიმბოლოს.");
      return;
    }
    const ageNum = age ? parseInt(age, 10) : null;
    if (ageNum !== null && (isNaN(ageNum) || ageNum < 0 || ageNum > 150)) {
      setError("გთხოვთ მიუთითოთ სწორი ასაკი.");
      return;
    }
    setError("");
    onSubmit({
      symptoms: symptoms.trim(),
      age: ageNum,
      sex,
      existingConditions: existing.trim(),
      medications: meds.trim(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Symptoms */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">
          სიმპტომების აღწერა <span className="text-danger">*</span>
        </label>
        <textarea
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          placeholder="დეტალურად აღწერეთ სიმპტომები: რა გაწუხებთ, რამდენ ხანს..."
          maxLength={2000}
          rows={4}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm resize-y
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
        <div className="text-xs text-text-muted text-right mt-1">{symptoms.length}/2000</div>
      </div>

      {/* Age + Sex */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">ასაკი</label>
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="მაგ: 45"
            min={0}
            max={150}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-navy mb-1.5">სქესი</label>
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
          >
            {sexOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Existing conditions */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">არსებული დიაგნოზები</label>
        <input
          type="text"
          value={existing}
          onChange={(e) => setExisting(e.target.value)}
          placeholder="მაგ: დიაბეტი, ჰიპერტენზია..."
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-teal/30 focus:border-teal transition"
        />
      </div>

      {/* Medications */}
      <div>
        <label className="block text-sm font-semibold text-navy mb-1.5">მიმდინარე მედიკამენტები</label>
        <input
          type="text"
          value={meds}
          onChange={(e) => setMeds(e.target.value)}
          placeholder="მაგ: მეტფორმინი 500მგ, ამლოდიპინი 5მგ..."
          maxLength={500}
          className="w-full px-4 py-3 rounded-xl border border-border bg-white text-sm
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
            "ანალიზის დაწყება"
          )}
        </button>
        <p className="text-xs text-text-muted text-center mt-2">ეს არ არის დიაგნოზი — მხოლოდ საინფორმაციო მიმოხილვა</p>
      </div>
    </form>
  );
}
