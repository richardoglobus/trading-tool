import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, LogOut, ShieldCheck, LoaderCircle } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function AuthGate() {
  const { user, loading, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [loginError, setLoginError] = useState("");
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
          <p className="auth-copy">This Tickwise dashboard is private. Only the one configured Manus account can access the live market monitor and paper-testing tools.</p>
          {deniedByCallback && <div className="auth-warning" role="alert">That Manus account is not authorized for this private site. Sign in with the configured admin account.</div>}
          {loginError && <div className="auth-warning" role="alert">{loginError}</div>}
          <button type="button" className="button-primary auth-submit" onClick={() => { setLoginError(""); try { startLogin(); } catch { setLoginError("Manus sign-in could not be opened. Please refresh and try again."); } }}>
            <ShieldCheck size={16} /> Sign in with Manus <ArrowRight size={15} />
          </button>
          <div className="auth-security-note"><LockKeyhole size={14} /><span>Tickwise does not request or store your Deriv password or API token. The balance calculator stays in this browser tab.</span></div>
          <p className="auth-footnote">Your Manus sign-in protects this dashboard; it does not sign in to or trade your Deriv account.</p>
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
          <AuthGate />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
