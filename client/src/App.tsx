import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, LockKeyhole, LogOut, Mail, ShieldCheck, LoaderCircle } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/_core/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const accessToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("access_token") ?? "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!accessToken) { setError("This reset link is missing or expired. Request a new link."); return; }
    if (password.length < 8 || password !== confirmation) { setError("Use at least 8 characters and make both passwords match."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not update password.");
      setPassword(""); setConfirmation(""); setMessage("Password updated. You can now sign in.");
      window.history.replaceState({}, "", "/login");
    } catch (resetError) { setError(resetError instanceof Error ? resetError.message : "Could not update password."); }
    finally { setSubmitting(false); }
  };

  return <main className="app-shell auth-shell"><section className="auth-card">
    <div className="auth-brand"><img src="/tickwise-mark.svg" alt="" /><span>tickwise<span>.</span></span></div>
    <div className="auth-kicker"><KeyRound size={13} /> PASSWORD RECOVERY</div>
    <h1 className="auth-heading">Set a new<br /><span>account password.</span></h1>
    <p className="auth-copy">Choose a new password for the authorized Tickwise administrator account.</p>
    {error && <div className="auth-warning" role="alert">{error}</div>}
    {message && <div className="auth-success" role="status">{message}</div>}
    <form onSubmit={submit}>
      <label className="auth-field"><span><KeyRound size={13} /> New password</span><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>
      <label className="auth-field"><span><KeyRound size={13} /> Confirm password</span><input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} required /></label>
      <button type="submit" className="button-primary auth-submit" disabled={submitting}>{submitting ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />} {submitting ? "Updating…" : "Update password"} <ArrowRight size={15} /></button>
    </form>
    <a className="auth-toggle auth-link" href="/login">Back to sign in</a>
  </section></main>;
}

function AuthGate() {
  const { user, loading, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [loginError, setLoginError] = useState("");
  const [email, setEmail] = useState("lewismurimi856@gmail.com");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot">("login");
  const [submitting, setSubmitting] = useState(false);
  const deniedByCallback = new URLSearchParams(window.location.search).get("error") === "not_authorized";

  useEffect(() => {
    if (user?.role === "admin" && location === "/login") setLocation("/");
  }, [location, setLocation, user?.role]);

  const signOut = async () => {
    try {
      await logout();
    } finally {
      window.location.replace("/login");
    }
  };

  const submitPasswordAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${authMode === "login" ? "login" : authMode === "signup" ? "signup" : "forgot-password"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, ...(authMode === "forgot" ? {} : { password }) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Authentication failed.");
      if (authMode === "forgot") {
        setLoginError("If this email is registered, a password-reset link has been sent. Check your inbox.");
        setAuthMode("login");
      } else if (result.confirmationRequired) {
        setPassword("");
        setAuthMode("login");
        setLoginError("Account created. Check your email to confirm it, then sign in here.");
      } else {
        window.location.replace("/");
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Authentication failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="app-shell auth-shell" aria-live="polite">
        <div className="auth-loading"><LoaderCircle size={19} className="spin" /> Verifying private session…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div className="auth-brand"><img src="/tickwise-mark.svg" alt="" /><span>tickwise<span>.</span></span></div>
          <div className="auth-kicker"><LockKeyhole size={13} /> PRIVATE ADMIN WORKSPACE</div>
          <h1 className="auth-heading">Sign in to<br /><span>your market lab.</span></h1>
          <p className="auth-copy">This Tickwise dashboard is private. Only the configured administrator email can access the live market monitor and paper-testing tools.</p>
          {deniedByCallback && <div className="auth-warning" role="alert">That account is not authorized for this private site.</div>}
          {loginError && <div className="auth-warning" role="alert">{loginError}</div>}
          <form onSubmit={submitPasswordAuth}>
            <label className="auth-field"><span><Mail size={13} /> Email</span><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
            {authMode !== "forgot" && <label className="auth-field"><span><KeyRound size={13} /> Password</span><input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></label>}
            <button type="submit" className="button-primary auth-submit" disabled={submitting}>
              {submitting ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />} {submitting ? "Sending…" : authMode === "login" ? "Sign in" : authMode === "signup" ? "Create admin account" : "Send reset link"} <ArrowRight size={15} />
            </button>
          </form>
          <button type="button" className="button-quiet auth-toggle" onClick={() => { setLoginError(""); setAuthMode(authMode === "login" ? "signup" : "login"); }}>
            {authMode === "login" ? "First time? Create the admin account" : "Already registered? Sign in"}
          </button>
          {authMode === "login" && <button type="button" className="button-quiet auth-toggle" onClick={() => { setLoginError(""); setAuthMode("forgot"); }}>Forgot password?</button>}
          {authMode === "forgot" && <button type="button" className="button-quiet auth-toggle" onClick={() => { setLoginError(""); setAuthMode("login"); }}>Back to sign in</button>}
          <div className="auth-security-note"><LockKeyhole size={14} /><span>Supabase securely stores the password. Tickwise never requests or stores your Deriv password or API token.</span></div>
          <p className="auth-footnote">Use the configured admin email only. Your Tickwise password is separate from your Deriv account.</p>
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div className="auth-kicker"><LockKeyhole size={13} /> ACCESS RESTRICTED</div>
          <h1 className="auth-heading">This account<br /><span>is not authorized.</span></h1>
          <p className="auth-copy">Tickwise is limited to its single configured admin account.</p>
          <button type="button" className="button-quiet auth-signout" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
        </section>
      </main>
    );
  }

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {window.location.pathname === "/reset-password" ? <ResetPasswordPage /> : <AuthGate />}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
