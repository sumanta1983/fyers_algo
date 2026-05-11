"use client";

import { useEffect, useRef, useState } from "react";
import { WS_BASE, type Signal } from "./api";

type StreamStatus = "connecting" | "open" | "closed";

type SignalMessage =
  | ({ type: "signal" } & Omit<Signal, "id" | "ts"> & { ts?: string })
  | { type: "hello"; filterSymbol: string | null };

// Subscribe to /ws/signals. Reconnects with exponential backoff on close.
// Keeps the most recent `max` signals in state.
export function useSignalStream(opts: { symbol?: string; max?: number } = {}) {
  const { symbol, max = 50 } = opts;
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [signals, setSignals] = useState<Signal[]>([]);
  const reconnectAttempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByCaller = useRef(false);

  useEffect(() => {
    closedByCaller.current = false;

    const url = new URL(`${WS_BASE}/ws/signals`);
    if (symbol) url.searchParams.set("symbol", symbol);

    let ws: WebSocket | null = null;

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(url.toString());

      ws.addEventListener("open", () => {
        reconnectAttempts.current = 0;
        setStatus("open");
      });

      ws.addEventListener("message", (ev) => {
        let msg: SignalMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type !== "signal") return;
        const incoming: Signal = {
          id: Date.now() + Math.random(),
          ts: msg.ts ?? new Date().toISOString(),
          candle_ts: msg.candle_ts,
          symbol: msg.symbol,
          strategy: msg.strategy,
          side: msg.side,
          price: msg.price,
          reason: msg.reason,
        };
        setSignals((prev) => [incoming, ...prev].slice(0, max));
      });

      ws.addEventListener("close", () => {
        setStatus("closed");
        if (closedByCaller.current) return;
        const attempt = ++reconnectAttempts.current;
        // 500ms, 1s, 2s, 4s, 8s (cap)
        const delay = Math.min(500 * 2 ** (attempt - 1), 8000);
        timer.current = setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {
        // 'error' is always followed by 'close'; let close handle reconnect.
      });
    };

    connect();

    return () => {
      closedByCaller.current = true;
      if (timer.current) clearTimeout(timer.current);
      ws?.close();
    };
  }, [symbol, max]);

  return { status, signals };
}
