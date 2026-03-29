import { GUMROAD_URL } from "@/lib/constants";

interface PricingCTAProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export default function PricingCTA({
  size = "md",
  label = "Get Access — $9/month",
}: PricingCTAProps) {
  const sizeClasses = {
    sm: "px-5 py-2 text-[0.8125rem]",
    md: "px-6 py-3 text-[0.875rem]",
    lg: "px-8 py-4 text-base",
  };

  return (
    <a
      href={GUMROAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-block rounded-full font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 ${sizeClasses[size]}`}
      style={{
        background: "#2ECC71",
        boxShadow: "0 4px 15px rgba(46, 204, 113, 0.3)",
      }}
    >
      {label}
    </a>
  );
}
