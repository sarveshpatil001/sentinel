import { useAuth } from "@/hooks/use-auth";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";

export function RequireAuth({
  children,
  title = "Sign in to continue",
  description = "This page requires an authenticated session.",
  redirectImmediately = false,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  redirectImmediately?: boolean;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <main><p role="status">Checking session…</p></main>;
  }
  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const signInHref = `/auth?returnTo=${encodeURIComponent(returnTo)}`;
    if (redirectImmediately) return <Navigate to={signInHref} replace />;
    return (
      <main>
        <h1>{title}</h1>
        <p>{description}</p>
        <p>You will return to this page after signing in.</p>
        <p><Link to={signInHref}>Sign in</Link> · <Link to="/">Home</Link></p>
      </main>
    );
  }
  return children;
}
