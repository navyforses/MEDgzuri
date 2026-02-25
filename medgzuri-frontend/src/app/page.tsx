"use client";

import { useState } from "react";
import TabSelector from "@/components/TabSelector";
import ResearchForm from "@/components/ResearchForm";
import SymptomsForm from "@/components/SymptomsForm";
import ClinicsForm from "@/components/ClinicsForm";
import LoadingSteps from "@/components/LoadingSteps";
import ResultsDisplay from "@/components/ResultsDisplay";
import { search } from "@/lib/api";
import type { SearchType, SearchData, SearchResponse } from "@/types/api";

export default function Home() {
  const [activeTab, setActiveTab] = useState<SearchType>("research");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [resultType, setResultType] = useState<SearchType>("research");
  const [error, setError] = useState("");

  const handleSearch = async (type: SearchType, data: SearchData) => {
    setIsLoading(true);
    setResult(null);
    setError("");
    setResultType(type);

    try {
      const response = await search({ type, data });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ძიება ვერ შესრულდა. გთხოვთ სცადოთ თავიდან.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTabChange = (tab: SearchType) => {
    if (!isLoading) {
      setActiveTab(tab);
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="bg-white border-b border-border-light">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-teal flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-navy leading-tight">MED&გზური</h1>
              <p className="text-[10px] text-text-muted leading-tight">სამედიცინო კვლევების ნავიგატორი</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <TabSelector activeTab={activeTab} onTabChange={handleTabChange} disabled={isLoading} />

        {/* Form panel */}
        <div className="bg-white rounded-2xl shadow-sm border border-border-light p-5 sm:p-6">
          {activeTab === "research" && (
            <ResearchForm onSubmit={(data) => handleSearch("research", data)} isLoading={isLoading} />
          )}
          {activeTab === "symptoms" && (
            <SymptomsForm onSubmit={(data) => handleSearch("symptoms", data)} isLoading={isLoading} />
          )}
          {activeTab === "clinics" && (
            <ClinicsForm onSubmit={(data) => handleSearch("clinics", data)} isLoading={isLoading} />
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-sm border border-border-light">
            <LoadingSteps type={activeTab} />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="bg-danger/5 border border-danger/20 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm text-danger font-medium">{error}</p>
            <button
              onClick={() => setError("")}
              className="px-5 py-2 bg-danger/10 text-danger text-sm font-medium rounded-xl hover:bg-danger/20 transition"
            >
              თავიდან ცდა
            </button>
          </div>
        )}

        {/* Results */}
        {result && !isLoading && (
          <div className="bg-white rounded-2xl shadow-sm border border-border-light p-5 sm:p-6">
            <ResultsDisplay response={result} type={resultType} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border-light mt-12 py-6">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <p className="text-xs text-text-muted">
            &copy; 2024-2026 MED&გზური &mdash; სამედიცინო კვლევების ნავიგატორი
          </p>
          <p className="text-[10px] text-text-muted mt-1">
            ეს სერვისი არ ანაცვლებს ექიმის კონსულტაციას
          </p>
        </div>
      </footer>
    </div>
  );
}
