"use client";

import { useEffect, useState } from "react";
import { SearchType } from "@/types/api";

const stepsByType: Record<SearchType, string[]> = {
  research: ["PubMed ძიება", "კლინიკური კვლევები", "მკურნალობის ანალიზი", "ანგარიშის შექმნა"],
  symptoms: ["სიმპტომების შეფასება", "გამოკვლევების შერჩევა", "სპეციალისტების შეფასება", "ანგარიშის შექმნა"],
  clinics: ["კლინიკების ძიება", "ფასების ანალიზი", "შეფასებების შეკრება", "ანგარიშის შექმნა"],
};

interface Props {
  type: SearchType;
}

export default function LoadingSteps({ type }: Props) {
  const steps = stepsByType[type];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 4000);
    return () => clearInterval(interval);
  }, [steps.length]);

  return (
    <div className="flex flex-col items-center py-12 gap-6">
      <div className="relative w-16 h-16">
        <svg className="animate-spin w-16 h-16 text-teal" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>

      <div>
        <p className="text-lg font-semibold text-navy text-center">ანალიზი მიმდინარეობს...</p>
        <p className="text-sm text-text-secondary text-center mt-1">
          გთხოვთ დაელოდოთ, ეს შეიძლება რამდენიმე წუთი გასტანოს
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {steps.map((step, i) => {
          const isDone = i < activeStep;
          const isActive = i === activeStep;
          return (
            <div key={step} className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${isDone ? "bg-success text-white" : isActive ? "bg-teal text-white step-active" : "bg-border-light text-text-muted"}`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span
                className={`text-sm transition-all ${isDone ? "text-success font-medium" : isActive ? "text-navy font-semibold" : "text-text-muted"}`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
