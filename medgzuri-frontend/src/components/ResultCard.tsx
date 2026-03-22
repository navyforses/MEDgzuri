"use client";

import { ResultItem, SearchType } from "@/types/api";

const priorityConfig = {
  high: { label: "მაღალი პრიორიტეტი", color: "bg-danger/10 text-danger", dot: "bg-danger" },
  medium: { label: "საშუალო პრიორიტეტი", color: "bg-warning/10 text-warning", dot: "bg-warning" },
  low: { label: "დაბალი პრიორიტეტი", color: "bg-success/10 text-success", dot: "bg-success" },
};

function renderBody(body: string): string {
  // Simple markdown-like rendering (bold, lists, line breaks)
  return body
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^\s*[-•]\s+(.+)/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*<\/li>)/, "<ul>$1</ul>")
    .replace(/\n/g, "<br/>");
}

interface Props {
  item: ResultItem;
  type: SearchType;
}

export default function ResultCard({ item, type }: Props) {
  const priority = item.priority && priorityConfig[item.priority];

  return (
    <div className="bg-white rounded-2xl border border-border-light shadow-sm hover:shadow-md transition-shadow p-5 space-y-3">
      {/* Priority badge */}
      {priority && (
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${priority.color}`}>
          <span className={`w-2 h-2 rounded-full ${priority.dot}`} />
          {priority.label}
        </span>
      )}

      {/* Header */}
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-light flex items-center justify-center text-teal shrink-0">
          {type === "research" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          )}
          {type === "symptoms" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          )}
          {type === "clinics" && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-navy text-sm leading-snug">{item.title}</h3>
          <p className="text-xs text-text-secondary mt-0.5">{item.source}</p>
        </div>
      </div>

      {/* Body */}
      <div
        className="result-body text-sm text-text-secondary leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderBody(item.body) }}
      />

      {/* Rating */}
      {item.rating != null && item.rating > 0 && (
        <div className="flex items-center gap-1 text-sm text-warning">
          <span>&#9733;</span>
          <span className="font-medium">{item.rating.toFixed(1)}/5</span>
        </div>
      )}

      {/* Phase badge */}
      {item.phase && (
        <span className="inline-block text-xs font-medium bg-teal-pale text-teal-hover px-2.5 py-1 rounded-full">
          {item.phase}
        </span>
      )}

      {/* Price */}
      {item.price && (
        <div className="text-sm font-medium text-navy">
          <span className="mr-1">&#128176;</span>{item.price}
        </div>
      )}

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.tags.map((tag) => (
            <span key={tag} className="text-xs bg-bg px-2.5 py-1 rounded-full text-text-secondary border border-border-light">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Link */}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-teal hover:text-teal-hover font-medium transition"
        >
          წყაროს ნახვა
          <span>&rarr;</span>
        </a>
      )}
    </div>
  );
}
