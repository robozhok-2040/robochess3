"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type IchuckyStats = {
  last7d: {
    attempts: number;
    correct: number;
    accuracy: number;
    avgTimeSeconds: number | null;
  };
  streak: {
    current: number;
  };
  last10: Array<{
    at: string;
    isCorrect: boolean;
    timeSpentSeconds: number | null;
    piecesCount: number | null;
  }>;
};

function formatLast10Row(entry: IchuckyStats["last10"][number]) {
  const status = entry.isCorrect ? "✅" : "❌";
  const pieces = entry.piecesCount ?? "—";
  const time = entry.timeSpentSeconds ?? "—";
  return `${status} фігур: ${pieces} · час: ${time}с`;
}

export default function IchuckyCard() {
  const router = useRouter();
  const [stats, setStats] = useState<IchuckyStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      try {
        const response = await fetch("/api/student/ichucky/stats", {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error("Failed to load iChucky stats");
        }

        const payload = (await response.json()) as IchuckyStats;
        if (isMounted) {
          setStats(payload);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load iChucky stats");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadStats();
    return () => {
      isMounted = false;
    };
  }, []);

  const attempts = stats?.last7d.attempts ?? 0;
  const accuracy = stats?.last7d.accuracy ?? 0;
  const avgTimeSeconds = stats?.last7d.avgTimeSeconds ?? null;
  const currentStreak = stats?.streak.current ?? 0;
  const last10 = stats?.last10 ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>iChucky (Візуалізація)</CardTitle>
          <CardDescription>Знайди фігуру, яка може потрапити на задане поле</CardDescription>
        </div>
        <Button onClick={() => router.push("/student/ichucky")}>Почати</Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Завантаження статистики...</p>
        )}
        {!loading && error && (
          <p className="text-sm text-[hsl(var(--destructive))]">Не вдалося завантажити статистику.</p>
        )}
        {!loading && !error && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-[hsl(var(--muted-foreground))]">
                  Спроби за 7 днів
                </p>
                <p className="text-lg font-semibold text-[hsl(var(--foreground))]">{attempts}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Точність</p>
                <p className="text-lg font-semibold text-[hsl(var(--foreground))]">{accuracy}%</p>
              </div>
              <div>
                <p className="text-xs uppercase text-[hsl(var(--muted-foreground))]">
                  Поточний streak
                </p>
                <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
                  {currentStreak}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-[hsl(var(--muted-foreground))]">
                  Середній час (с)
                </p>
                <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
                  {avgTimeSeconds ?? "—"}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Останні 10</p>
              {last10.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Немає спроб за останні 7 днів.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-[hsl(var(--foreground))]">
                  {last10.map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>{formatLast10Row(entry)}</li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

