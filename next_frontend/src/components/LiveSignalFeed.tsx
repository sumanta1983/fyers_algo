"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useSignalStream } from "@/lib/useSignalStream";

function StatusDot({ status }: { status: "connecting" | "open" | "closed" }) {
  const color =
    status === "open"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {status}
    </span>
  );
}

export function LiveSignalFeed() {
  const { status, signals } = useSignalStream({ max: 50 });

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Live signals</CardTitle>
          <StatusDot status={status} />
        </div>
        <CardDescription>
          Live stream from <code className="text-xs">/ws/signals</code>. Most
          recent first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <ScrollArea className="h-[420px] pr-3">
          {signals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Waiting for signals…
            </p>
          ) : (
            <ul className="space-y-2">
              {signals.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge
                      variant={s.side === "BUY" ? "default" : "destructive"}
                      className="font-mono"
                    >
                      {s.side}
                    </Badge>
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate">{s.symbol}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.strategy} ·{" "}
                        {new Date(s.candle_ts).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-sm tabular-nums">
                    ₹{s.price.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
