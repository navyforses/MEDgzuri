import Link from "next/link";
import { GUMROAD_URL, MEDGZURI_URL, CONTACT_EMAIL } from "@/lib/constants";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {/* About */}
          <div>
            <h3 className="text-lg font-bold text-primary-700">GrantKit</h3>
            <p className="mt-3 text-sm text-gray-600">
              Curated grants for medical treatment and startups worldwide.
              Updated monthly.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
              Quick Links
            </h4>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  href="/"
                  className="text-sm text-gray-600 hover:text-primary-700"
                >
                  Home
                </Link>
              </li>
              <li>
                <Link
                  href="/grants"
                  className="text-sm text-gray-600 hover:text-primary-700"
                >
                  Grants Directory
                </Link>
              </li>
              <li>
                <a
                  href={GUMROAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-600 hover:text-primary-700"
                >
                  Subscribe
                </a>
              </li>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-sm text-gray-600 hover:text-primary-700"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* MedGzuri */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
              Part of MedGzuri
            </h4>
            <p className="mt-3 text-sm text-gray-600">
              GrantKit is a product by MedGzuri — Georgian medical research
              navigation service.
            </p>
            <a
              href={MEDGZURI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-medium text-primary-700 hover:underline"
            >
              Visit MedGzuri &rarr;
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-gray-200 pt-6 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} GrantKit. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
