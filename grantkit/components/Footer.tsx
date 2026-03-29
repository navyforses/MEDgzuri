import Link from "next/link";
import { GUMROAD_URL, CONTACT_EMAIL } from "@/lib/constants";

export default function Footer() {
  return (
    <footer style={{ background: "#F8FAFC", borderTop: "1px solid #E2E8F0" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* About */}
          <div>
            <div className="flex items-center gap-2">
              <svg width="24" height="24" viewBox="0 0 100 100" fill="none">
                <rect width="100" height="100" rx="20" fill="#1B4F72" />
                <path
                  d="M25 65V35L38 55L50 35V65"
                  stroke="white"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M58 50H80"
                  stroke="#2ECC71"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
                <path
                  d="M62 35L75 50L62 65"
                  stroke="white"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="text-base font-bold"
                style={{ color: "#1B4F72" }}
              >
                MED&amp;გზური
              </span>
              <span
                className="text-sm font-medium"
                style={{ color: "rgba(26, 32, 44, 0.4)" }}
              >
                | Grants
              </span>
            </div>
            <p
              className="mt-3 text-[0.875rem] leading-relaxed"
              style={{ color: "rgba(26, 32, 44, 0.6)" }}
            >
              Curated grants for medical treatment and startups worldwide.
              Updated monthly.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1A202C" }}
            >
              Quick Links
            </h4>
            <ul className="mt-3 space-y-2">
              {[
                { label: "Home", href: "/" },
                { label: "Search", href: "/product" },
                { label: "Grants Directory", href: "/grants", internal: true },
                { label: "Subscribe", href: GUMROAD_URL, external: true },
              ].map((link) => (
                <li key={link.label}>
                  {link.internal ? (
                    <Link
                      href={link.href}
                      className="text-[0.875rem] transition-colors duration-200 hover:underline"
                      style={{ color: "rgba(26, 32, 44, 0.6)" }}
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="text-[0.875rem] transition-colors duration-200 hover:underline"
                      style={{ color: "rgba(26, 32, 44, 0.6)" }}
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-[0.1em]"
              style={{ color: "#1A202C" }}
            >
              Contact
            </h4>
            <p
              className="mt-3 text-[0.875rem] leading-relaxed"
              style={{ color: "rgba(26, 32, 44, 0.6)" }}
            >
              Part of MedGzuri — Georgian medical research navigation service.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-2 inline-block text-[0.875rem] font-medium transition-colors duration-200 hover:underline"
              style={{ color: "#1B4F72" }}
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>

        <div
          className="mt-10 pt-6 text-center text-[0.8125rem]"
          style={{
            borderTop: "1px solid #E2E8F0",
            color: "rgba(26, 32, 44, 0.4)",
          }}
        >
          &copy; {new Date().getFullYear()} MED&amp;გზური. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
