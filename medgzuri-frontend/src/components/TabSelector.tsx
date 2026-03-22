"use client";

import { SearchType } from "@/types/api";

const tabs: { type: SearchType; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  {
    type: "research",
    label: "კვლევების ძიება",
    shortLabel: "კვლევა",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    type: "symptoms",
    label: "სიმპტომების ნავიგაცია",
    shortLabel: "სიმპტომები",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    type: "clinics",
    label: "კლინიკების ძიება",
    shortLabel: "კლინიკა",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M5 21V7l8-4v18" />
        <path d="M19 21V11l-6-4" />
        <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" />
      </svg>
    ),
  },
];

interface Props {
  activeTab: SearchType;
  onTabChange: (tab: SearchType) => void;
  disabled?: boolean;
}

export default function TabSelector({ activeTab, onTabChange, disabled }: Props) {
  return (
    <div className="flex gap-2 p-1 bg-white rounded-2xl shadow-sm border border-border-light">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.type;
        return (
          <button
            key={tab.type}
            onClick={() => onTabChange(tab.type)}
            disabled={disabled}
            className={`
              flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all flex-1 justify-center
              ${isActive
                ? "bg-teal text-white shadow-md"
                : "text-text-secondary hover:bg-teal-light hover:text-teal"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
