"use client";

import { SearchResponse, SearchType } from "@/types/api";
import ResultCard from "./ResultCard";

const titleByType: Record<SearchType, string> = {
  research: "კვლევების შედეგები",
  symptoms: "სიმპტომების ანალიზი",
  clinics: "ნაპოვნი კლინიკები",
};

interface Props {
  response: SearchResponse;
  type: SearchType;
}

export default function ResultsDisplay({ response, type }: Props) {
  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-navy">{titleByType[type]}</h2>
        {response.isDemo && (
          <span className="text-xs bg-warning/10 text-warning px-3 py-1 rounded-full font-medium">
            Demo
          </span>
        )}
      </div>

      {/* Meta */}
      {response.meta && (
        <div className="bg-teal-light rounded-xl p-4 text-sm text-navy leading-relaxed">
          {response.meta}
        </div>
      )}

      {/* Tips */}
      {response.tips && response.tips.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {response.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 bg-white rounded-xl border border-border-light p-3">
              <span className="text-lg">{tip.icon}</span>
              <span className="text-sm text-text-secondary">{tip.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Comparison table */}
      {response.comparison && response.comparison.headers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                {response.comparison.headers.map((h) => (
                  <th key={h} className="text-left px-4 py-2 bg-bg font-semibold text-navy border-b border-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {response.comparison.rows.map((row, i) => (
                <tr key={i} className="border-b border-border-light hover:bg-teal-light/50 transition">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2.5 text-text-secondary">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Result cards */}
      {response.items && response.items.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {response.items.map((item, i) => (
            <ResultCard key={i} item={item} type={type} />
          ))}
        </div>
      )}

      {/* Summary fallback */}
      {(!response.items || response.items.length === 0) && response.summary && (
        <div className="bg-white rounded-2xl border border-border-light p-6">
          <div
            className="result-body text-sm text-text-secondary leading-relaxed"
            dangerouslySetInnerHTML={{ __html: response.summary.replace(/\n/g, "<br/>") }}
          />
        </div>
      )}

      {/* Next steps */}
      {response.nextSteps && response.nextSteps.length > 0 && (
        <div className="bg-success/5 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-navy text-sm">შემდეგი ნაბიჯები</h3>
          {response.nextSteps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-text-secondary">
              <span>{step.icon}</span>
              <span>{step.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline info */}
      {response._pipeline && (
        <p className="text-xs text-text-muted text-right">
          {(response._pipeline.ms / 1000).toFixed(1)}წმ &middot; {response._pipeline.source}
        </p>
      )}

      {/* Disclaimer */}
      <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 text-xs text-text-secondary leading-relaxed">
        {response.disclaimer || "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას. წარმოდგენილი ინფორმაცია განკუთვნილია საინფორმაციო მიზნებისთვის. ნებისმიერი სამედიცინო გადაწყვეტილება უნდა მიიღოთ კვალიფიციურ სპეციალისტთან კონსულტაციის შემდეგ."}
      </div>
    </div>
  );
}
