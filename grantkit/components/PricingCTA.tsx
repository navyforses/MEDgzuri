const GUMROAD_URL = "https://YOURUSERNAME.gumroad.com/l/grantkit";

interface PricingCTAProps {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export default function PricingCTA({
  size = "md",
  label = "Get Access — $9/month",
}: PricingCTAProps) {
  const sizeClasses = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  };

  return (
    <a
      href={GUMROAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-block rounded-lg bg-accent font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover ${sizeClasses[size]}`}
    >
      {label}
    </a>
  );
}
