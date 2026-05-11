"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function StrategySwitcher() {
  const [active, setActive] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, s] = await Promise.all([
          api.activeStrategy(),
          api.strategies(),
        ]);
        if (cancelled) return;
        setActive(a.active);
        setUpdatedAt(a.updated_at);
        setStrategies(s.strategies);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onChange(name: string | null) {
    if (!name || name === active) return;
    setPending(name);
    setError(null);
    try {
      const next = await api.setActiveStrategy(name);
      setActive(next.active);
      setUpdatedAt(next.updated_at);
      toast.success(`Active strategy set to ${next.active}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Failed to switch strategy: ${msg}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Strategy</CardTitle>
        <CardDescription>
          The Python engine hot-swaps on save (via Redis pub
          <code className="mx-1 text-xs">strategy.changed</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {active ? (
            <Badge variant="secondary" className="text-sm">
              {active}
            </Badge>
          ) : (
            <Badge variant="outline">loading…</Badge>
          )}
          {updatedAt && (
            <span className="text-xs text-muted-foreground">
              updated {new Date(updatedAt).toLocaleString()}
            </span>
          )}
        </div>

        <Select
          value={active ?? ""}
          disabled={!active || strategies.length === 0 || pending !== null}
          onValueChange={onChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a strategy" />
          </SelectTrigger>
          <SelectContent>
            {strategies.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
