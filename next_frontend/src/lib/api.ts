// Thin client over the Node backend (M6 routes).
// Override the base URL via NEXT_PUBLIC_API_BASE in .env.local.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_BASE ?? API_BASE.replace(/^http/, "ws");

export type Signal = {
  id: number;
  ts: string;
  candle_ts: string;
  symbol: string;
  strategy: string;
  side: "BUY" | "SELL";
  price: number;
  reason: Record<string, unknown>;
};

export type SignalsResponse = { signals: Signal[] };

export type StrategiesResponse = { strategies: string[] };

export type ActiveStrategyResponse = {
  active: string;
  updated_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  signals(params: { symbol?: string; limit?: number } = {}) {
    const qs = new URLSearchParams();
    if (params.symbol) qs.set("symbol", params.symbol);
    qs.set("limit", String(params.limit ?? 50));
    return request<SignalsResponse>(`/signals?${qs.toString()}`);
  },
  strategies() {
    return request<StrategiesResponse>("/strategies");
  },
  activeStrategy() {
    return request<ActiveStrategyResponse>("/strategies/active");
  },
  setActiveStrategy(name: string) {
    return request<ActiveStrategyResponse>("/strategies/active", {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  },
};
