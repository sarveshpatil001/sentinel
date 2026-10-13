import { Link } from "react-router";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>The requested route does not exist.</p>
      <p><Link to="/">Home</Link> · <Link to="/dashboard">Workspace</Link></p>
    </main>
  );
}
