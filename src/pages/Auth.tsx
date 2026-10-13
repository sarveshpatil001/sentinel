import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

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
    <main>
      <h1>Sign in</h1>
      <p>Temporary authentication form. UI design is pending.</p>
      {authLoading && <p role="status">Checking session…</p>}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy || authLoading}>
          <legend>{email === null ? "Email sign-in" : "Verify your email"}</legend>
          {email === null ? (
            <label>Email <input name="email" type="email" autoComplete="email" required /></label>
          ) : (
            <>
              <p>A verification code was sent to {email}.</p>
              <input name="email" type="hidden" value={email} />
              <label>Verification code <input name="code" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required /></label>
            </>
          )}
          <button type="submit" disabled={email !== null && !/^[0-9]{6}$/.test(otp)}>{busy ? "Please wait…" : email === null ? "Send code" : "Verify code"}</button>
          {email !== null && <button type="button" onClick={() => { setEmail(null); setOtp(""); setError(null); }}>Use a different email</button>}
        </fieldset>
      </form>
      <p><button type="button" onClick={guestLogin} disabled={busy || authLoading}>Continue as guest</button></p>
      <p>Guest sessions retain the existing limited permissions; they do not bypass authentication.</p>
      <Link to="/">Home</Link>
    </main>
  );
}
