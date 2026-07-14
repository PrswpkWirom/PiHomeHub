import { Laptop, Moon, Sun } from "lucide-react";

import { useTheme } from "../contexts/ThemeContext";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop }
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  if (compact) {
    const activeOption = options.find((option) => option.value === theme) ?? options[2];
    const ActiveIcon = theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;
    const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

    return (
      <button
        type="button"
        className="icon-button h-10 w-10"
        aria-label={`Theme: ${activeOption.label}. Switch theme`}
        onClick={() => setTheme(nextTheme)}
      >
        <ActiveIcon size={17} strokeWidth={2} />
      </button>
    );
  }

  return (
    <div className="theme-control" aria-label="Theme preference">
      {options.map((option) => {
        const Icon = option.icon;
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={`theme-control__option ${
              selected ? "theme-control__option--active" : ""
            }`}
            onClick={() => setTheme(option.value)}
          >
            <Icon size={15} strokeWidth={2} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
