import { StrategySwitcher } from "@/components/StrategySwitcher";
import { LiveSignalFeed } from "@/components/LiveSignalFeed";
import { SignalsHistory } from "@/components/SignalsHistory";

export default function DashboardPage() {
  return (
    <main className="flex-1 px-6 py-8 max-w-7xl mx-auto w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          fyers_algo dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Live intraday signals — Fyers WS → Node aggregator → Python engine →
          Postgres + Redis pub/sub.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StrategySwitcher />
        <LiveSignalFeed />
      </div>

      <SignalsHistory />
    </main>
  );
}
