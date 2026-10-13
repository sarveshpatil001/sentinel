import { Link } from "react-router";

export default function Landing() {
  return (
    <main>
      <h1>Sentinel Prime</h1>
      <p>The previous interface has been removed. UI design is pending.</p>
      <p>This temporary interface retains authenticated access to existing functionality. Live trading remains unavailable.</p>
      <nav aria-label="Application access">
        <ul>
          <li><Link to="/auth?returnTo=%2Fdashboard">Sign in</Link></li>
          <li><Link to="/dashboard">Open workspace</Link></li>
        </ul>
      </nav>
    </main>
  );
}
