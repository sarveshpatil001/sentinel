import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  AnalysisIcon,
  BrandMark,
  ChartsIcon,
  ChevronLeftIcon,
  HistoryIcon,
  HomeIcon,
  SettingsIcon,
  StatusIcons,
  TradingIcon,
} from "./icons";

export const NAV_ITEMS = [
  { path: "/dashboard", label: "Home", Icon: HomeIcon },
  { path: "/trading", label: "Trading", Icon: TradingIcon },
  { path: "/charts", label: "Charts", Icon: ChartsIcon },
  { path: "/analysis", label: "Analysis", Icon: AnalysisIcon },
  { path: "/history", label: "History", Icon: HistoryIcon },
  { path: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

export function StatusBar() {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between px-7">
      <span className="text-[14px] font-bold text-sp-status">9:41</span>
      <StatusIcons className="h-[12px] w-[40px] text-sp-status" />
    </div>
  );
}

export function AppBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const onWorkspaceRoot = location.pathname.startsWith("/dashboard");
  return (
    <div className="mt-1.5 flex h-9 shrink-0 items-center px-5">
      <button
        type="button"
        aria-label={onWorkspaceRoot ? "Back to home" : "Back to workspace home"}
        onClick={() => navigate(onWorkspaceRoot ? "/" : "/dashboard")}
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-sp-line bg-sp-raised text-[#90A4BE] transition-colors hover:border-sp-line-hero hover:text-sp-soft"
      >
        <ChevronLeftIcon className="h-[18px] w-[18px]" />
      </button>
      <div className="ml-3 flex items-center gap-1.5">
        <BrandMark className="h-[22px] w-[26px]" />
        <span className="text-[16px] font-extrabold text-sp-status">Sentinel Prime</span>
      </div>
      <span className="ml-auto flex h-[26px] w-[88px] items-center justify-center gap-2 rounded-full border border-sp-cyan/30 bg-sp-raised">
        <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-sp-cyan" />
        <span className="text-[11px] font-semibold text-[#DCE8F5]">Demo</span>
      </span>
    </div>
  );
}

export function PageHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mt-4 px-5">
      <h1 className="text-[22px] font-extrabold leading-tight text-sp-text">{title}</h1>
      <p className="mt-1 text-[12px] text-sp-muted">{sub}</p>
    </div>
  );
}

export function BottomNav({ activePath }: { activePath: string }) {
  return (
    <nav
      aria-label="Workspace screens"
      className="relative z-20 h-[88px] shrink-0 border-t border-[#121D2C] bg-[#040810]"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-white/15 to-transparent"
      />
      <ul className="grid grid-cols-6 pt-2">
        {NAV_ITEMS.map(({ path, label, Icon }) => {
          const active = path === activePath;
          return (
            <li key={path}>
              <Link
                to={path}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[48px] flex-col items-center gap-1.5 pt-1 ${active ? "text-sp-cyan" : "text-[#5D738A]"}`}
              >
                <span
                  aria-hidden="true"
                  className={`h-[2px] w-[18px] rounded-full ${active ? "bg-sp-cyan" : "bg-transparent"}`}
                />
                <Icon className="h-[20px] w-[24px]" />
                <span className={`text-[9.5px] ${active ? "font-bold" : "font-medium"}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppFrame({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="relative flex h-dvh w-full max-w-[390px] flex-col overflow-hidden sm:my-5 sm:h-[844px] sm:max-h-[calc(100dvh_-_2.5rem)] sm:rounded-[36px] sm:border sm:border-sp-line">
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[340px] w-full"
      >
        <defs>
          <radialGradient id="sp-mesh" cx="50%" cy="0%" r="50%">
            <stop offset="0%" stopColor="#00E5C9" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#040810" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="340" fill="url(#sp-mesh)" />
      </svg>
      <div className="relative z-10 flex flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="flex min-h-full flex-col">
          <StatusBar />
          <AppBar />
          {children}
        </div>
      </div>
      <BottomNav activePath={activePath} />
    </div>
  );
}
