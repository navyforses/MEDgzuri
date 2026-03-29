"use client";

import { useState } from "react";

interface FAQItem {
  q: string;
  a: string;
}

export default function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={i}
            className="overflow-hidden rounded-[16px] bg-white transition-shadow duration-200"
            style={{
              border: "1px solid #E2E8F0",
              boxShadow: isOpen
                ? "0 4px 12px rgba(26, 32, 44, 0.08)"
                : "0 1px 3px rgba(26, 32, 44, 0.06)",
            }}
          >
            <button
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="flex w-full items-center justify-between px-6 py-5 text-left"
            >
              <span
                className="text-[0.9375rem] font-semibold"
                style={{ color: "#1A202C" }}
              >
                {item.q}
              </span>
              <svg
                className="h-5 w-5 flex-shrink-0 transition-transform duration-200"
                style={{
                  color: "rgba(26, 32, 44, 0.4)",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0)",
                }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            <div
              className="transition-all duration-200"
              style={{
                maxHeight: isOpen ? "160px" : "0",
                overflow: "hidden",
                paddingBottom: isOpen ? "20px" : "0",
              }}
            >
              <p
                className="px-6 text-[0.875rem] leading-relaxed"
                style={{ color: "rgba(26, 32, 44, 0.6)" }}
              >
                {item.a}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
