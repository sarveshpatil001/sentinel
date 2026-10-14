type IconProps = { className?: string };

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M 15 8 L 10 12 L 15 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true">
      <path d="M 13 0 L 23 5 L 23 16 L 13 22 L 3 16 L 3 5 Z" fill="#00E5C9" />
      <path d="M 13 3 L 19 6 L 19 14 L 13 18 L 7 14 L 7 6 Z" fill="#050912" />
    </svg>
  );
}

export function StatusIcons({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 12" className={className} aria-hidden="true" fill="none">
      <path d="M 0 11 L 2 9 M 4 11 L 6 7 M 8 11 L 10 5 M 12 11 L 14 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="18.5" y="1.5" width="18" height="9" rx="3" stroke="currentColor" strokeWidth="1.1" />
      <rect x="20.5" y="3.5" width="11" height="5" rx="1.5" fill="#00E5C9" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M 8 5 L 8 8 L 11 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" fill="none">
      <circle cx="18" cy="18" r="4.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M 21.5 21.5 L 25 25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 8" className={className} aria-hidden="true" fill="none">
      <path d="M 2 2.5 L 6 6.5 L 10 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 14" className={className} aria-hidden="true" fill="none">
      <path d="M 1 12 L 7 4 L 11 8 L 18 1 M 14 1 L 18 1 L 18 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 14" className={className} aria-hidden="true" fill="none">
      <path d="M 6 12 L 6 3 M 2 7 L 6 3 L 10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 12 14" className={className} aria-hidden="true" fill="none">
      <path d="M 6 3 L 6 12 M 2 8 L 6 12 L 10 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true">
      <path d="M 7 12 L 15 6 L 23 12 L 23 19 L 7 19 Z" fill="currentColor" />
      <rect x="12" y="14" width="6" height="5" fill="#040810" />
    </svg>
  );
}

export function TradingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true" fill="none">
      <path d="M 8 7 L 18 17 M 18 7 L 13 7 M 18 7 L 18 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true" fill="none">
      <path d="M 7 18 L 7 11 M 13 18 L 13 5 M 19 18 L 19 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AnalysisIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true" fill="none">
      <circle cx="13" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M 13 7 L 13 15 M 9 11 L 17 11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true" fill="none">
      <circle cx="13" cy="11" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M 13 8 L 13 11 L 16 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 26 22" className={className} aria-hidden="true" fill="none">
      <circle cx="13" cy="11" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M 13 5 L 13 7 M 13 15 L 13 17 M 7 11 L 9 11 M 17 11 L 19 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
