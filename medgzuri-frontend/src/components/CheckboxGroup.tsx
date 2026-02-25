"use client";

interface Option {
  label: string;
  value: string;
}

interface Props {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export default function CheckboxGroup({ options, selected, onChange }: Props) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => toggle(opt.value)}
          className={`checkbox-item ${selected.includes(opt.value) ? "checked" : ""}`}
        >
          <span className="w-4 h-4 rounded border-2 flex items-center justify-center text-xs transition-all
            ${selected.includes(opt.value) ? 'border-teal bg-teal text-white' : 'border-border'}">
            {selected.includes(opt.value) && "✓"}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
