import { ENV } from "./env";

const API_BASE = "https://api.derivws.com";
const DEMO_SYMBOL = "1HZ100V";

type DemoAccount = { id: string; account_type?: string; status?: string; currency?: string };

async function derivFetch(path: string, init: RequestInit = {}) {
  if (!ENV.derivPat || !ENV.derivAppId) throw new Error("Deriv credentials are not configured");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ENV.derivPat}`,
      "Deriv-App-ID": ENV.derivAppId,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `Deriv request failed (${response.status})`);
  return body;
}

export async function listDemoAccounts() {
  const result = await derivFetch("/trading/v1/options/accounts");
  const accounts = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
  return accounts.filter((account: DemoAccount) => String(account.account_type ?? "").toLowerCase() === "demo");
}

export async function getDemoWebSocketUrl(accountId: string) {
  const result = await derivFetch(`/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, { method: "POST" });
  const url = result?.data?.url;
  if (typeof url !== "string" || !url.startsWith("wss://")) throw new Error("Deriv did not return a demo WebSocket URL");
  return url;
}

export async function getDemoConnection() {
  const accounts = await listDemoAccounts();
  const account = accounts[0] as DemoAccount | undefined;
  if (!account?.id) throw new Error("No Deriv demo account was returned for this PAT");
  const websocketUrl = await getDemoWebSocketUrl(account.id);
  return { accountId: account.id, currency: account.currency ?? "USD", websocketUrl, symbol: DEMO_SYMBOL };
}

export async function getDemoBalance() {
  const { websocketUrl, accountId, currency } = await getDemoConnection();
  const balance = await new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Deriv balance request timed out")); }, 10000);
    socket.onopen = () => socket.send(JSON.stringify({ balance: 1, req_id: 1 }));
    socket.onmessage = event => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.error) throw new Error(payload.error.message || "Deriv balance request failed");
        if (payload?.msg_type === "balance" && Number.isFinite(Number(payload.balance?.balance))) {
          clearTimeout(timeout); socket.close(); resolve(Number(payload.balance.balance));
        }
      } catch (error) { clearTimeout(timeout); socket.close(); reject(error); }
    };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error("Deriv demo WebSocket failed")); };
  });
  return { accountId, currency, balance };
}

export const derivDemoConfig = {
  symbol: DEMO_SYMBOL,
  stake: 1,
  duration: 5,
  durationUnit: "t",
  fastSma: 5,
  slowSma: 20,
  threshold: 0.1,
  takeProfit: 10,
  stopLoss: -10,
  maxTrades: 200,
};
