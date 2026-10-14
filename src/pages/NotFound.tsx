import { Link } from "react-router";
import { BrandMark } from "@/components/sentinel/icons";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-sp-canvas px-5 text-sp-text">
      <div className="w-full max-w-[390px]">
        <BrandMark className="h-[26px] w-[30px]" />
        <h1 className="mt-6 text-[22px] font-extrabold leading-tight">Page not found</h1>
        <p className="mt-2 text-[12px] text-sp-muted">The requested route does not exist.</p>
        <p className="mt-6 flex gap-2.5">
          <Link
            to="/"
            className="flex h-12 flex-1 items-center justify-center rounded-[12px] border border-sp-line-hero bg-sp-glass text-[13px] font-bold text-sp-soft transition-colors hover:border-sp-cyan hover:text-sp-cyan"
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="flex h-12 flex-1 items-center justify-center rounded-[12px] bg-sp-cyan text-[13px] font-extrabold text-sp-canvas transition-opacity hover:opacity-90"
          >
            Workspace
          </Link>
        </p>
      </div>
    </main>
  );
}
