import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { BrandMark } from "@/components/sentinel/icons";

interface AuthProps { redirectAfterAuth?: string }

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") && !/^\/auth(?:[/?#]|$)/.test(returnTo)) {
    return returnTo;
  }
  return fallback;
}

export default function AuthPage({ redirectAfterAuth }: AuthProps) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(params.get("returnTo"), redirectAfterAuth);
  const [email, setEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [authLoading, isAuthenticated, navigate, redirect]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formData = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn("email-otp", formData);
      if (email === null) {
        setEmail(String(formData.get("email")));
      } else {
        navigate(redirect, { replace: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed. Please try again.");
      if (email !== null) setOtp("");
    } finally {
      setBusy(false);
    }
  }

  async function guestLogin() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn("anonymous");
      navigate(redirect, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Guest sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center bg-sp-canvas px-5 pb-12 pt-10 text-sp-text">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[320px] w-full">
        <defs>
          <radialGradient id="sp-mesh-auth" cx="50%" cy="0%" r="50%">
            <stop offset="0%" stopColor="#00E5C9" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#040810" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="320" fill="url(#sp-mesh-auth)" />
      </svg>

      <div className="relative z-10 w-full max-w-[390px]">
        <div className="flex items-center gap-2">
          <BrandMark className="h-[26px] w-[30px]" />
          <span className="text-[15px] font-extrabold tracking-[0.4px] text-sp-status">Sentinel Prime</span>
        </div>

        <h1 className="mt-8 text-[22px] font-extrabold leading-tight">Sign in</h1>
        <p className="mt-1 text-[12px] text-sp-muted">
          Access the EUR/USD analysis workspace. Demo mode only.
        </p>

        {authLoading && (
          <p role="status" className="mt-4 text-[12px] text-sp-muted-2">
            Checking session…
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-[8px] border border-[#3D141C] bg-[#1C090D] px-3 py-2 text-[11.5px] text-sp-red">
            {error}
          </p>
        )}

        <form onSubmit={submit} className="mt-5">
          <fieldset disabled={busy || authLoading} className="rounded-[16px] border border-sp-line bg-linear-to-b from-sp-glass to-sp-glass-deep p-4">
            <legend className="px-1 text-[11px] font-semibold tracking-[0.6px] text-sp-muted">
              {email === null ? "Email sign-in" : "Verify your email"}
            </legend>
            {email === null ? (
              <label className="mt-1 block">
                <span className="text-[11px] font-semibold text-sp-soft">Email</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="mt-1.5 h-11 w-full rounded-[10px] border border-sp-chip bg-[#0A111D] px-3 text-[13px] text-sp-text placeholder:text-sp-muted focus:border-sp-cyan focus:outline-none"
                />
              </label>
            ) : (
              <>
                <p className="mt-1 text-[11.5px] text-sp-muted-2">
                  A verification code was sent to {email}.
                </p>
                <input name="email" type="hidden" value={email} />
                <label className="mt-3 block">
                  <span className="text-[11px] font-semibold text-sp-soft">Verification code</span>
                  <input
                    name="code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    className="mt-1.5 h-11 w-full rounded-[10px] border border-sp-chip bg-[#0A111D] px-3 text-[13px] tabular-nums text-sp-text placeholder:text-sp-muted focus:border-sp-cyan focus:outline-none"
                  />
                </label>
              </>
            )}
            <button
              type="submit"
              disabled={email !== null && !/^[0-9]{6}$/.test(otp)}
              className="mt-4 flex h-12 w-full items-center justify-center rounded-[12px] bg-sp-cyan text-[13px] font-extrabold text-sp-canvas transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Please wait…" : email === null ? "Send code" : "Verify code"}
            </button>
            {email !== null && (
              <button
                type="button"
                onClick={() => { setEmail(null); setOtp(""); setError(null); }}
                className="mt-2 flex h-11 w-full items-center justify-center rounded-[12px] border border-sp-line-hero text-[12px] font-bold text-sp-soft transition-colors hover:border-sp-cyan hover:text-sp-cyan"
              >
                Use a different email
              </button>
            )}
          </fieldset>
        </form>

        <button
          type="button"
          onClick={guestLogin}
          disabled={busy || authLoading}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-[12px] border border-sp-line-hero bg-sp-glass text-[13px] font-bold text-sp-soft transition-colors hover:border-sp-cyan hover:text-sp-cyan disabled:opacity-60"
        >
          Continue as guest
        </button>
        <p className="mt-3 text-[10.5px] leading-relaxed text-sp-muted">
          Guest sessions retain the existing limited permissions; they do not bypass authentication.
        </p>

        <p className="mt-6">
          <Link to="/" className="text-[12px] font-semibold text-sp-cyan hover:underline">
            Home
          </Link>
        </p>
      </div>
    </main>
  );
}
