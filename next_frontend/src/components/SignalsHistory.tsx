"use client";

import { useEffect, useState } from "react";
import { api, type Signal } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export function SignalsHistory() {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.signals({ limit: 50 });
        if (!cancelled) {
          setSignals(res.signals);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent signals</CardTitle>
        <CardDescription>
          Latest 50 rows from the <code className="text-xs">signals</code>{" "}
          table. Refreshes every 15s.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive mb-3">Failed to load: {error}</p>
        )}
        {signals === null ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : signals.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No signals yet. They'll appear here as the engine fires them.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time (IST)</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Side</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signals.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(s.ts).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour12: false,
                    })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.symbol}</TableCell>
                  <TableCell className="text-xs">{s.strategy}</TableCell>
                  <TableCell>
                    <Badge
                      variant={s.side === "BUY" ? "default" : "destructive"}
                      className="font-mono"
                    >
                      {s.side}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    ₹{s.price.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
