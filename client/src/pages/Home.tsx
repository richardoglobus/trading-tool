import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CircleAlert,
  Clock3,
  Info,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Signal,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

type FeedStatus = "connecting" | "live" | "disconnected" | "error";
type Tick = { seq: number; quote: number; epoch: number; precision: number };
type Direction = "rise" | "fall" | "flat";
type PendingTrade = { direction: Exclude<Direction, "flat">; entry: number; remaining: number };
type PaperState = {
  running: boolean;
  stake: number;
  payout: number;
  duration: number;
  stopLoss: number;
  wins: number;
  losses: number;
  ties: number;
  net: number;
  pending: PendingTrade | null;
  lastResult: string;
};

type Market = { symbol: string; label: string; short: string };
const MARKETS: Market[] = [
  { symbol: "1HZ100V", label: "Volatility 100 (1s)", short: "V100 · 1s" },
  { symbol: "1HZ75V", label: "Volatility 75 (1s)", short: "V75 · 1s" },
  { symbol: "1HZ50V", label: "Volatility 50 (1s)", short: "V50 · 1s" },
  { symbol: "1HZ25V", label: "Volatility 25 (1s)", short: "V25 · 1s" },
  { symbol: "1HZ10V", label: "Volatility 10 (1s)", short: "V10 · 1s" },
];
const FEED_ENDPOINTS = [
  "wss://api.derivws.com/trading/v1/options/ws/public",
  "wss://ws.binaryws.com/websockets/v3",
  "wss://ws.derivws.com/websockets/v3",
];
const MAX_TICKS = 1200;
const INITIAL_PAPER: PaperState = {
  running: false,
  stake: 1,
  payout: 90,
  duration: 5,
  stopLoss: 5,
  wins: 0,
  losses: 0,
  ties: 0,
  net: 0,
  pending: null,
  lastResult: "Waiting for the next 5/20 trend signal.",
};

function useDerivFeed(symbol: string) {
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [error, setError] = useState("");
  const [feedSymbol, setFeedSymbol] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let messageTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let endpointIndex = 0;
    let retryDelay = 1800;
    let receivedTick = false;

    setStatus("connecting");
    setTicks([]);
    setError("");
    setFeedSymbol(symbol);

    const appendLiveTick = (quote: unknown, epoch: unknown, precision: unknown) => {
      const value = Number(quote);
      const time = Number(epoch);
      if (!Number.isFinite(value)) return;
      sequence.current += 1;
      const tick: Tick = {
        seq: sequence.current,
        quote: value,
        epoch: Number.isFinite(time) ? time : Math.floor(Date.now() / 1000),
        precision: Number.isFinite(Number(precision)) ? Math.min(6, Math.max(0, Number(precision))) : 2,
      };
      setTicks((current) => [...current, tick].slice(-MAX_TICKS));
      setStatus("live");
      setError("");
      receivedTick = true;
      retryDelay = 1800;
      if (messageTimer) clearTimeout(messageTimer);
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!active) return;
        setStatus("disconnected");
        setError("No live tick has arrived for 8 seconds. Reconnecting…");
        if (socket?.readyState === WebSocket.OPEN) socket.close();
      }, 8000);
    };

    const connect = () => {
      if (!active) return;
      setStatus("connecting");
      receivedTick = false;
      try {
        socket = new WebSocket(FEED_ENDPOINTS[endpointIndex]);
      } catch {
        scheduleRetry();
        return;
      }
      const currentSocket = socket;
      messageTimer = setTimeout(() => {
        if (active && !receivedTick && currentSocket.readyState === WebSocket.OPEN) {
          setError("No tick response yet; trying another public feed address.");
          currentSocket.close();
        }
      }, 12000);

      currentSocket.onopen = () => {
        if (!active) return;
        try {
          currentSocket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: 2 }));
        } catch {
          currentSocket.close();
        }
      };

      currentSocket.onmessage = (event) => {
        if (!active) return;
        try {
          const data = JSON.parse(String(event.data));
          if (data?.error?.message) {
            setError(String(data.error.message));
            if (!receivedTick) currentSocket.close();
            return;
          }
          if (data?.msg_type === "tick" && data?.tick) {
            appendLiveTick(data.tick.quote, data.tick.epoch, data.tick.pip_size);
          }
        } catch {
          setError("The feed sent a response that could not be read. Reconnecting…");
        }
      };

      currentSocket.onerror = () => {
        if (active) setError("The public feed connection was interrupted. Reconnecting…");
      };

      currentSocket.onclose = () => {
        if (!active) return;
        if (!receivedTick) endpointIndex = (endpointIndex + 1) % FEED_ENDPOINTS.length;
        setStatus("disconnected");
        if (messageTimer) clearTimeout(messageTimer);
        if (staleTimer) clearTimeout(staleTimer);
        scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (!active) return;
      if (retryTimer) clearTimeout(retryTimer);
      setStatus("disconnected");
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(15000, Math.round(retryDelay * 1.7));
    };

    connect();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (messageTimer) clearTimeout(messageTimer);
      if (staleTimer) clearTimeout(staleTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [symbol]);

  return { status, ticks, error, feedSymbol };
}

function movingAverage(ticks: Tick[], period: number): number | null {
  if (ticks.length < period) return null;
  const window = ticks.slice(-period);
  return window.reduce((sum, tick) => sum + tick.quote, 0) / period;
}

function formatPrice(value: number | null | undefined, precision = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

function formatTime(epoch: number | undefined) {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusBadge({ status }: { status: FeedStatus }) {
  const label = status === "live" ? "LIVE DATA" : status === "connecting" ? "CONNECTING" : status === "error" ? "FEED ISSUE" : "OFFLINE";
  const Icon = status === "live" ? Wifi : status === "connecting" ? RefreshCw : WifiOff;
  return (
    <span className={`status-badge status-${status}`}>
      <Icon size={13} className={status === "connecting" ? "spin" : ""} />
      {label}
    </span>
  );
}

function PriceChart({ ticks, precision }: { ticks: Tick[]; precision: number }) {
  const values = ticks.slice(-120);
  if (values.length < 2) {
    return (
      <div className="chart-wait">
        <span className="chart-wait-mark"><Activity size={18} /></span>
        <span>{values.length ? "Collecting the first price moves…" : "Waiting for live price ticks…"}</span>
      </div>
    );
  }
  const width = 880;
  const height = 248;
  const padX = 5;
  const padTop = 14;
  const padBottom = 18;
  const min = Math.min(...values.map((tick) => tick.quote));
  const max = Math.max(...values.map((tick) => tick.quote));
  const range = max - min || 1;
  const points = values.map((tick, index) => ({
    x: padX + (index / Math.max(1, values.length - 1)) * (width - padX * 2),
    y: height - padBottom - ((tick.quote - min) / range) * (height - padTop - padBottom),
    tick,
  }));
  const line = points.map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width - padX},${height - padBottom} L${padX},${height - padBottom} Z`;
  const latest = points[points.length - 1];
  return (
    <div className="price-chart">
      <div className="chart-scale">
        <span>{formatPrice(max, precision)}</span>
        <span>{formatPrice((max + min) / 2, precision)}</span>
        <span>{formatPrice(min, precision)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Recent live price ticks">
        <defs>
          <linearGradient id="tickwise-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#b7f36b" stopOpacity=".19" />
            <stop offset="100%" stopColor="#b7f36b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((lineNo) => <line key={lineNo} x1="0" x2={width} y1={padTop + lineNo * 70} y2={padTop + lineNo * 70} className="chart-gridline" />)}
        <path d={area} fill="url(#tickwise-area)" />
        <path d={line} fill="none" className="chart-line" />
        <circle cx={latest.x} cy={latest.y} r="4" className="chart-dot" />
      </svg>
      <div className="chart-times"><span>{formatTime(values[0]?.epoch)}</span><span>LAST {values.length} TICKS</span><span>{formatTime(values[values.length - 1]?.epoch)}</span></div>
    </div>
  );
}

function DigitBars({ ticks }: { ticks: Tick[] }) {
  const counts = Array.from({ length: 10 }, (_, digit) => ticks.reduce((sum, tick) => {
    const last = Math.abs(Math.round(tick.quote * 10 ** tick.precision)) % 10;
    return sum + (last === digit ? 1 : 0);
  }, 0));
  const maximum = Math.max(1, ...counts);
  return (
    <div className="digit-chart">
      {counts.map((count, digit) => {
        const height = ticks.length ? Math.max(count ? 7 : 2, (count / maximum) * 100) : 2;
        return (
          <div className="digit-column" key={digit}>
            <span className="digit-count">{count || ""}</span>
            <div className="digit-bar-track"><div className={`digit-bar ${digit % 2 ? "digit-bar-alt" : ""}`} style={{ height: `${height}%` }} /></div>
            <span className="digit-label">{digit}</span>
          </div>
        );
      })}
    </div>
  );
}

function SignalPill({ direction }: { direction: Direction }) {
  const label = direction === "rise" ? "RISE BIAS" : direction === "fall" ? "FALL BIAS" : "NO SIGNAL";
  const Icon = direction === "rise" ? TrendingUp : direction === "fall" ? TrendingDown : Activity;
  return <span className={`signal-pill signal-${direction}`}><Icon size={14} />{label}</span>;
}

export default function Home() {
  const [symbol, setSymbol] = useState("1HZ100V");
  const [windowSize, setWindowSize] = useState(100);
  const { status, ticks, error, feedSymbol } = useDerivFeed(symbol);
  const [paper, setPaper] = useState<PaperState>(INITIAL_PAPER);
  const [balanceInput, setBalanceInput] = useState("");
  const [riskPercent, setRiskPercent] = useState(1);
  const { user, logout } = useAuth();
  const [demoStatus, setDemoStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [demoBalance, setDemoBalance] = useState<number | null>(null);
  const [demoCurrency, setDemoCurrency] = useState("USD");
  const [demoError, setDemoError] = useState("");
  const processedSeq = useRef(0);
  const pendingRef = useRef<PendingTrade | null>(null);
  const latest = ticks[ticks.length - 1];
  const prices = useMemo(() => ticks.slice(-windowSize), [ticks, windowSize]);
  const fastSma = useMemo(() => movingAverage(ticks, 5), [ticks]);
  const slowSma = useMemo(() => movingAverage(ticks, 20), [ticks]);
  const direction: Direction = fastSma === null || slowSma === null
    ? "flat"
    : fastSma > slowSma ? "rise" : fastSma < slowSma ? "fall" : "flat";
  const evens = prices.reduce((count, tick) => {
    const digit = Math.abs(Math.round(tick.quote * 10 ** tick.precision)) % 10;
    return count + (digit % 2 === 0 ? 1 : 0);
  }, 0);
  const odds = prices.length - evens;
  const selectedMarket = MARKETS.find((market) => market.symbol === symbol) ?? MARKETS[0];
  const tradeCount = paper.wins + paper.losses + paper.ties;
  const resolvedCount = paper.wins + paper.losses;
  const winRate = resolvedCount ? (paper.wins / resolvedCount) * 100 : 0;
  const breakEven = 100 / (1 + paper.payout / 100);
  const potentialWin = paper.stake * (paper.payout / 100);
  const maxLosingTrades = paper.stake > 0 ? Math.floor(paper.stopLoss / paper.stake) : 0;
  const enteredBalance = Number(balanceInput);
  const riskBudget = balanceInput.trim() && Number.isFinite(enteredBalance) && enteredBalance > 0 && enteredBalance <= 100000000
    ? enteredBalance * riskPercent / 100
    : null;
  const canApplyRiskBudget = riskBudget !== null && riskBudget >= 0.35 && !paper.running;

  useEffect(() => {
    if (!paper.running) {
      if (ticks.length) processedSeq.current = Math.max(processedSeq.current, ...ticks.map((tick) => tick.seq));
      return;
    }
    const fresh = ticks.filter((tick) => tick.seq > processedSeq.current);
    if (!fresh.length) return;

    for (const tick of fresh) {
      processedSeq.current = tick.seq;
      const index = ticks.findIndex((candidate) => candidate.seq === tick.seq);
      if (pendingRef.current) {
        const pending = { ...pendingRef.current, remaining: pendingRef.current.remaining - 1 };
        if (pending.remaining <= 0) {
          pendingRef.current = null;
          const outcome = tick.quote === pending.entry ? "tie" : (pending.direction === "rise" ? tick.quote > pending.entry : tick.quote < pending.entry) ? "win" : "loss";
          setPaper((current) => {
            const next: PaperState = {
              ...current,
              wins: current.wins + (outcome === "win" ? 1 : 0),
              losses: current.losses + (outcome === "loss" ? 1 : 0),
              ties: current.ties + (outcome === "tie" ? 1 : 0),
              net: current.net + (outcome === "win" ? current.stake * current.payout / 100 : outcome === "loss" ? -current.stake : 0),
              pending: null,
              lastResult: `${pending.direction === "rise" ? "Rise" : "Fall"} simulation ${outcome === "tie" ? "tied" : outcome === "win" ? "won" : "lost"} after ${current.duration} ticks.`,
            };
            if (next.net <= -next.stopLoss) next.running = false;
            return next;
          });
          continue;
        }
        pendingRef.current = pending;
        setPaper((current) => ({ ...current, pending }));
        continue;
      }

      const sample = ticks.slice(Math.max(0, index - 19), index + 1);
      const fast = movingAverage(sample, 5);
      const slow = movingAverage(sample, 20);
      if (fast === null || slow === null || fast === slow) continue;
      const nextPending: PendingTrade = {
        direction: fast > slow ? "rise" : "fall",
        entry: tick.quote,
        remaining: paper.duration,
      };
      pendingRef.current = nextPending;
      setPaper((current) => ({ ...current, pending: nextPending, lastResult: `${nextPending.direction === "rise" ? "Rise" : "Fall"} simulation opened at ${formatPrice(tick.quote, tick.precision)}.` }));
    }
  }, [ticks, paper.running, paper.duration]);

  useEffect(() => {
    pendingRef.current = paper.pending;
  }, [paper.pending]);

  const changeMarket = (nextSymbol: string) => {
    if (nextSymbol === symbol) return;
    pendingRef.current = null;
    processedSeq.current = 0;
    setPaper((current) => ({
      ...INITIAL_PAPER,
      stake: current.stake,
      payout: current.payout,
      duration: current.duration,
      stopLoss: current.stopLoss,
      lastResult: "Market changed. Start a fresh paper run for this index.",
    }));
    setSymbol(nextSymbol);
  };

  const updatePaper = (field: "stake" | "payout" | "duration" | "stopLoss", value: number) => {
    const bounds = { stake: [0.35, 10000], payout: [1, 500], duration: [3, 20], stopLoss: [1, 100000] } as const;
    const [minimum, maximum] = bounds[field];
    const bounded = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
    setPaper((current) => ({ ...current, [field]: bounded }));
  };

  const applyBalanceSizing = () => {
    if (riskBudget === null || riskBudget < 0.35 || paper.running) return;
    updatePaper("stake", Math.min(10000, riskBudget));
  };

  const signOutAdmin = async () => {
    try {
      await logout();
    } finally {
      window.location.replace("/login");
    }
  };

  const connectDemo = async () => {
    setDemoStatus("connecting"); setDemoError("");
    try {
      const response = await fetch("/api/deriv/demo/connect", { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Demo connection failed");
      const balanceResponse = await fetch("/api/deriv/demo/balance", { credentials: "include" });
      const balanceResult = await balanceResponse.json();
      if (!balanceResponse.ok) throw new Error(balanceResult.error || "Could not read demo balance");
      setDemoStatus("connected"); setDemoBalance(Number(balanceResult.balance)); setDemoCurrency(balanceResult.currency || result.currency || "USD");
    } catch (connectionError) { setDemoStatus("error"); setDemoError(connectionError instanceof Error ? connectionError.message : "Demo connection failed"); }
  };

  const startPaper = () => {
    if (status !== "live" || ticks.length < 20) return;
    const latestSeq = ticks[ticks.length - 1]?.seq ?? 0;
    processedSeq.current = latestSeq;
    pendingRef.current = null;
    setPaper((current) => ({ ...current, running: true, wins: 0, losses: 0, ties: 0, net: 0, pending: null, lastResult: "Simulation started. Waiting for an SMA 5/20 signal." }));
  };

  const stopPaper = () => {
    pendingRef.current = null;
    processedSeq.current = Math.max(processedSeq.current, latest?.seq ?? 0);
    setPaper((current) => ({ ...current, running: false, pending: null, lastResult: "Simulation stopped. Results are kept on this page until reset." }));
  };

  const resetPaper = () => {
    pendingRef.current = null;
    processedSeq.current = Math.max(processedSeq.current, latest?.seq ?? 0);
    setPaper((current) => ({ ...INITIAL_PAPER, stake: current.stake, payout: current.payout, duration: current.duration, stopLoss: current.stopLoss }));
  };

  const signalReady = status === "live" && feedSymbol === symbol && ticks.length >= 20;
  const rateLabel = `${winRate.toFixed(1)}%`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/tickwise-mark.svg" alt="" className="brand-mark" />
          <span className="brand-name">tickwise<span className="brand-period">.</span></span>
          <span className="brand-divider" />
          <span className="brand-product">DERIV MARKET LAB</span>
        </div>
        <div className="topbar-right">
          <span className="private-feed-label"><span className="public-feed-dot" />PRIVATE · MANUS ADMIN</span>
          <StatusBadge status={status} />
          <span className="admin-email" title={user?.email ?? "Signed-in administrator"}>{user?.email}</span>
          <button type="button" className="sign-out-button" onClick={() => void signOutAdmin()} aria-label="Sign out" title="Sign out"><LogOut size={14} /><span>Sign out</span></button>
        </div>
      </header>

      <div className="page-content">
        <section className="intro-row">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" />LIVE MARKET MONITOR</div>
            <h1>Read the tape.<br /><span>Test the rules.</span></h1>
            <p className="intro-copy">A clear view of the ticks behind your demo strategy. Signals describe recent movement — they do not predict the next tick.</p>
          </div>
          <div className="mode-note"><ShieldCheck size={17} /><div><strong>DEMO BOT · OFF</strong><span>{demoStatus === "connected" ? `Demo balance: ${demoCurrency} ${demoBalance?.toFixed(2) ?? "—"}` : "Connect your Deriv demo account to view balance."}</span><button type="button" className="button-quiet demo-connect-button" onClick={() => void connectDemo()} disabled={demoStatus === "connecting"}>{demoStatus === "connected" ? "Refresh balance" : demoStatus === "connecting" ? "Connecting…" : "Connect demo"}</button>{demoError && <small className="demo-error">{demoError}</small>}</div></div>
        </section>

        <section className="market-toolbar panel">
          <div className="market-select-group">
            <label htmlFor="market-select">MARKET</label>
            <select id="market-select" value={symbol} onChange={(event) => changeMarket(event.target.value)}>
              {MARKETS.map((market) => <option key={market.symbol} value={market.symbol}>{market.label}</option>)}
            </select>
          </div>
          <div className="toolbar-divider" />
          <div className="market-meta"><span>SYMBOL</span><strong>{symbol}</strong></div>
          <div className="toolbar-spacer" />
          <div className="window-select-group">
            <label htmlFor="window-select">TICK WINDOW</label>
            <select id="window-select" value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value))}>
              {[100, 300, 500, 1000].map((count) => <option value={count} key={count}>Last {count} ticks</option>)}
            </select>
          </div>
        </section>

        {error && (
          <div className={`feed-alert ${status === "live" ? "feed-alert-muted" : ""}`} role="status">
            <CircleAlert size={16} /><span>{error}</span>
            {status !== "live" && <button type="button" onClick={() => window.location.reload()} className="retry-button"><RefreshCw size={13} /> Retry now</button>}
          </div>
        )}

        <section className="overview-grid">
          <article className="panel price-panel">
            <div className="panel-heading">
              <div><span className="panel-kicker">MARKET PRICE</span><h2>{selectedMarket.label}</h2></div>
              <span className="live-chip"><span className={`live-chip-dot ${status === "live" ? "" : "dot-idle"}`} />{status === "live" ? "STREAMING" : status === "connecting" ? "CONNECTING" : "WAITING"}</span>
            </div>
            <div className="price-reading">
              <span className="price-value">{formatPrice(latest?.quote, latest?.precision ?? 2)}</span>
              <span className="price-change"><Activity size={14} />{ticks.length ? `${Math.min(ticks.length, 1200)} ticks cached` : "No tick data yet"}</span>
            </div>
            <PriceChart ticks={ticks} precision={latest?.precision ?? 2} />
            <div className="chart-footer"><span><Clock3 size={13} />Last update {formatTime(latest?.epoch)}</span><span>Public tick stream · 1s index</span></div>
          </article>

          <article className="panel signal-panel">
            <div className="panel-heading"><div><span className="panel-kicker">TREND CHECK</span><h2>Moving averages</h2></div><span className="icon-tile"><Zap size={17} /></span></div>
            <div className="signal-explainer"><span className="signal-explainer-icon"><Info size={15} /></span><span>INDICATOR, NOT PREDICTION</span></div>
            <div className="signal-hero">
              <div className={`signal-graphic ${direction}`}>
                {direction === "rise" ? <ArrowUpRight size={29} /> : direction === "fall" ? <ArrowDownRight size={29} /> : <Activity size={25} />}
              </div>
              <div><span className="signal-caption">CURRENT DIRECTION</span><SignalPill direction={direction} /></div>
            </div>
            <div className="sma-values">
              <div className="sma-value-row"><span><i className="sma-dot fast-dot" />FAST SMA <b>05</b></span><strong>{formatPrice(fastSma, latest?.precision ?? 2)}</strong></div>
              <div className="sma-value-row"><span><i className="sma-dot slow-dot" />SLOW SMA <b>20</b></span><strong>{formatPrice(slowSma, latest?.precision ?? 2)}</strong></div>
            </div>
            <p className="signal-footnote">Calculated from live tick quotes. Direction can change quickly; it is not a recommendation.</p>
            {!signalReady && <p className="warmup-note">{status === "live" ? `${Math.max(0, 20 - ticks.length)} more ticks to warm up the 20-period average.` : "Connect to the public feed to calculate the averages."}</p>}
          </article>
        </section>

        <section className="stats-grid">
          <article className="panel stats-panel digit-panel">
            <div className="panel-heading"><div><span className="panel-kicker">LAST-DIGIT DISTRIBUTION</span><h2>What just printed</h2></div><span className="sample-count">{prices.length} / {windowSize} ticks</span></div>
            <div className="digit-legend"><span><i className="legend-square" />Even</span><span><i className="legend-square legend-alt" />Odd</span><span className="digit-legend-note">Observed frequency only</span></div>
            <DigitBars ticks={prices} />
            <div className="even-odd-row">
              <div className="even-odd-stat"><span><i className="legend-square" />EVEN</span><strong>{evens}</strong><small>{prices.length ? `${((evens / prices.length) * 100).toFixed(1)}% of window` : "Waiting for ticks"}</small></div>
              <div className="even-odd-stat odd-stat"><span><i className="legend-square legend-alt" />ODD</span><strong>{odds}</strong><small>{prices.length ? `${((odds / prices.length) * 100).toFixed(1)}% of window` : "Waiting for ticks"}</small></div>
              <div className="even-odd-note"><Info size={14} /><span>Recent counts are descriptive. A digit appearing less often does not make it “due.”</span></div>
            </div>
          </article>

          <article className="panel stats-panel paper-panel">
            <div className="panel-heading"><div><span className="panel-kicker">DEMO STRATEGY LAB</span><h2>SMA paper run</h2></div><span className="sim-tag"><span />FAKE MONEY</span></div>
            <p className="paper-intro">Mirrors the 5/20 Rise/Fall rule using live ticks. One simulated position at a time.</p>
            <div className="paper-controls">
              <label>Stake <span><span>$</span><input aria-label="Hypothetical stake in dollars" type="number" min="0.35" max="10000" step="0.25" value={paper.stake} disabled={paper.running} onChange={(event) => updatePaper("stake", Number(event.target.value))} /></span></label>
              <label>Win payout <span><input aria-label="Hypothetical net payout percent" type="number" min="1" max="500" step="1" value={paper.payout} disabled={paper.running} onChange={(event) => updatePaper("payout", Number(event.target.value))} /><i>%</i></span></label>
              <label>Expiry <span><select aria-label="Hypothetical expiry in ticks" value={paper.duration} disabled={paper.running} onChange={(event) => updatePaper("duration", Number(event.target.value))}><option value={3}>3 ticks</option><option value={5}>5 ticks</option><option value={10}>10 ticks</option><option value={20}>20 ticks</option></select></span></label>
            </div>
            <div className="paper-actions">
              {!paper.running
                ? <button type="button" className="button-primary" disabled={!signalReady} onClick={startPaper}><Play size={15} fill="currentColor" />Start paper run</button>
                : <button type="button" className="button-stop" onClick={stopPaper}><Pause size={15} fill="currentColor" />Stop run</button>}
              <button type="button" className="button-quiet" onClick={resetPaper} title="Reset simulated results"><RotateCcw size={14} />Reset</button>
            </div>
            <div className="paper-result-line"><span className={`paper-state-dot ${paper.running ? "state-running" : ""}`} />{paper.running ? paper.pending ? `${paper.pending.direction.toUpperCase()} · expires in ${paper.pending.remaining} ticks` : "Running · waiting for a valid signal" : paper.lastResult}</div>
            <div className="paper-results">
              <div><span>WINS</span><strong className="result-green">{paper.wins}</strong></div>
              <div><span>LOSSES</span><strong className="result-red">{paper.losses}</strong></div>
              <div><span>WIN RATE</span><strong>{resolvedCount ? rateLabel : "—"}</strong></div>
              <div><span>HYPOTHETICAL P/L</span><strong className={paper.net > 0 ? "result-green" : paper.net < 0 ? "result-red" : ""}>{paper.net >= 0 ? "+" : ""}${paper.net.toFixed(2)}</strong></div>
            </div>
            <div className="paper-disclaimer"><ShieldCheck size={14} /><span>{tradeCount} simulated outcomes · no order is sent to Deriv.</span></div>
          </article>
        </section>

        <section className="panel risk-panel">
          <div className="risk-title"><span className="risk-icon"><BarChart3 size={17} /></span><div><span className="panel-kicker">POSITION MATH</span><h2>Risk calculator</h2></div></div>
          <div className="risk-subtitle">Hypothetical values based on your paper-run settings.</div>
          <div className="balance-sizing">
            <div className="balance-sizing-head"><ShieldCheck size={14} /><span>BALANCE-BASED PAPER SIZING · LOCAL ONLY</span></div>
            <div className="balance-sizing-controls">
              <label htmlFor="usd-balance">USD balance
                <span className="balance-input-wrap"><span>$</span><input id="usd-balance" type="number" min="0.01" max="100000000" step="0.01" autoComplete="off" value={balanceInput} onChange={(event) => setBalanceInput(event.target.value)} placeholder="Enter amount" /></span>
              </label>
              <label htmlFor="risk-percent">Example risk percent
                <span className="balance-input-wrap"><input id="risk-percent" type="number" min="0.1" max="100" step="0.1" value={riskPercent} onChange={(event) => { const value = Number(event.target.value); setRiskPercent(Number.isFinite(value) ? Math.min(100, Math.max(0.1, value)) : 0.1); }} /><span>%</span></span>
              </label>
              <div className="balance-sizing-result"><span>EXAMPLE FULL-STAKE LOSS BUDGET</span><strong>{riskBudget === null ? "—" : `$${riskBudget.toFixed(2)}`}</strong></div>
              <button type="button" className="button-primary balance-sizing-button" disabled={!canApplyRiskBudget} onClick={applyBalanceSizing}>Use as paper stake</button>
            </div>
            <p className="balance-sizing-note">{riskBudget === null ? "Enter a balance to calculate an illustrative amount." : riskBudget < 0.35 ? "Below the paper tool’s $0.35 minimum; no stake will be applied." : riskBudget > 10000 ? "The paper simulator caps the applied stake at $10,000." : "The default 1% is a demonstration value, not a recommendation."} The balance and percentage stay in this browser tab; they are not sent to the server or saved. This does not predict the next tick or choose Rise/Fall.</p>
          </div>
          <div className="risk-metrics">
            <div><span>WIN PROFIT IF RIGHT</span><strong className="result-green">+${potentialWin.toFixed(2)}</strong><small>at {paper.payout}% net payout</small></div>
            <div><span>LOSS IF WRONG</span><strong className="result-red">−${paper.stake.toFixed(2)}</strong><small>full stake at risk</small></div>
            <div><span>BREAK-EVEN WIN RATE</span><strong>{breakEven.toFixed(1)}%</strong><small>before costs or slippage</small></div>
            <div><span>LOSSES TO YOUR LIMIT</span><strong>{maxLosingTrades || "—"}</strong><small>full stake losses to −${paper.stopLoss.toFixed(2)}</small></div>
          </div>
          <div className="risk-limit-row"><label htmlFor="stop-loss">Paper-run stop limit</label><div className="stop-input"><span>$</span><input id="stop-loss" type="number" min="1" max="100000" step="1" value={paper.stopLoss} disabled={paper.running} onChange={(event) => updatePaper("stopLoss", Number(event.target.value))} /></div><span className="risk-limit-copy">The simulation stops when hypothetical P/L reaches this loss.</span></div>
          <div className="risk-caveat"><Info size={14} /><span>This calculator is not a forecast. Synthetic index ticks are volatile and a demo result does not establish an edge or guarantee live results.</span></div>
        </section>

        <footer className="footer-note">
          <span><ShieldCheck size={15} />For analysis and demo testing only.</span>
          <span>This page does not connect to, control, or trade your Deriv account. No income or profit is promised.</span>
          <a href="https://developers.deriv.com/docs/data/ticks/" target="_blank" rel="noreferrer">Deriv public tick API <span>↗</span></a>
        </footer>
      </div>
    </main>
  );
}
