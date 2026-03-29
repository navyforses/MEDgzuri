"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GUMROAD_URL } from "@/lib/constants";

const navLinks = [
  { href: "/", label: "Home", external: true },
  { href: "/product", label: "Search", external: true },
  { href: "/grants", label: "Grants" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const isGrantsActive = pathname === "/grantkit/grants" || pathname === "/grants";

  return (
    <nav
      className="fixed left-0 right-0 top-0 z-50"
      style={{
        background: "rgba(255, 255, 255, 0.97)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #E2E8F0",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3.5">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
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
          <span className="text-lg font-bold" style={{ color: "#1B4F72" }}>
            MED&amp;გზური
          </span>
          <span
            className="hidden text-sm font-medium sm:inline"
            style={{ color: "rgba(26, 32, 44, 0.4)" }}
          >
            | Grants
          </span>
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => {
            const isActive =
              link.label === "Grants" ? isGrantsActive : false;

            const el = (
              <span
                className="rounded-[8px] px-3 py-2 text-[0.8125rem] font-medium transition-all duration-200"
                style={{
                  color: isActive ? "#1B4F72" : "#1A202C",
                  background: isActive ? "rgba(27, 79, 114, 0.08)" : "transparent",
                }}
              >
                {link.label}
              </span>
            );

            if (link.external) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-[8px] transition-all duration-200 hover:bg-[rgba(27,79,114,0.08)]"
                >
                  {el}
                </a>
              );
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[8px] transition-all duration-200 hover:bg-[rgba(27,79,114,0.08)]"
              >
                {el}
              </Link>
            );
          })}

          <a
            href={GUMROAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 rounded-full px-5 py-2 text-[0.8125rem] font-semibold text-white transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: "#2ECC71",
              boxShadow: "0 2px 8px rgba(46, 204, 113, 0.3)",
            }}
          >
            Get Access
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(!open)}
          className="flex h-10 w-10 items-center justify-center rounded-[8px] transition-colors hover:bg-[rgba(27,79,114,0.08)] md:hidden"
          aria-label="Toggle menu"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="#1A202C"
            strokeWidth={2}
          >
            {open ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          className="px-4 pb-4 md:hidden"
          style={{ borderTop: "1px solid #E2E8F0", background: "white" }}
        >
          <div className="flex flex-col gap-1 pt-2">
            {navLinks.map((link) => {
              const isActive =
                link.label === "Grants" ? isGrantsActive : false;

              const className = `rounded-[8px] px-3 py-2.5 text-[0.875rem] font-medium transition-all duration-200 ${
                isActive ? "text-[#1B4F72]" : "text-[#1A202C]"
              }`;
              const style = {
                background: isActive ? "rgba(27, 79, 114, 0.08)" : "transparent",
              };

              if (link.external) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={className}
                    style={style}
                  >
                    {link.label}
                  </a>
                );
              }

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={className}
                  style={style}
                >
                  {link.label}
                </Link>
              );
            })}
            <a
              href={GUMROAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block rounded-full py-2.5 text-center text-[0.875rem] font-semibold text-white transition-all duration-200"
              style={{
                background: "#2ECC71",
                boxShadow: "0 2px 8px rgba(46, 204, 113, 0.3)",
              }}
            >
              Get Access — $9/month
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
