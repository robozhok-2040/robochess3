"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StaticBoard } from "@/components/chess/StaticBoard";

type PieceKind = "Q" | "R" | "B" | "N";
type PieceColor = "w";

type PieceState = {
  id: string;
  kind: PieceKind;
  color: PieceColor;
  displayColor: "w" | "b";
  displaySquare: string;
  virtualSquare: string;
};

type MoveHistoryItem = {
  stepIndex: number;
  targetSquare: string;
  correctPieceId: string;
  correctPieceLabel: string;
  chosenPieceId: string;
  chosenPieceLabel: string;
  isCorrect: boolean;
  virtualSnapshotBefore: Array<{ id: string; label: string; type: string; square: string }>;
};

type LastMistake = {
  target: string;
  correctPieceId: string;
  correctPieceLabel: string;
  correctFrom: string;
  chosenPieceId: string;
  chosenPieceLabel: string;
  chosenFrom: string;
  virtualPiecesSnapshot: Array<{ id: string; label: string; type: string; square: string }>;
};

type LeaderboardResponse = {
  me: { userId: string; bestStreak: number };
  top: Array<{ userId: string; label: string; bestStreak: number }>;
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks = [1, 2, 3, 4, 5, 6, 7, 8];
const FILES = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
const allSquares = files.flatMap((file) => ranks.map((rank) => `${file}${rank}`));

const kindLabels: Record<PieceKind, string> = {
  Q: "Ферзь",
  R: "Тура",
  B: "Слон",
  N: "Кінь",
};

const pieceIcons: Record<PieceKind, { w: string; b: string }> = {
  Q: { w: "♕", b: "♛" },
  R: { w: "♖", b: "♜" },
  B: { w: "♗", b: "♝" },
  N: { w: "♘", b: "♞" },
};

function squareToCoords(square: string) {
  const file = square[0];
  const rank = Number(square[1]);
  return {
    fileIndex: files.indexOf(file),
    rankIndex: ranks.indexOf(rank),
    rank,
  };
}

function squareToSvg(square: string) {
  const coords = squareToCoords(square);
  if (coords.fileIndex < 0 || coords.rankIndex < 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: coords.fileIndex,
    y: 7 - coords.rankIndex,
  };
}

function squareColor(square: string) {
  const coords = squareToCoords(square);
  if (coords.fileIndex < 0 || coords.rankIndex < 0) {
    return "light";
  }
  return (coords.fileIndex + coords.rankIndex) % 2 === 0 ? "light" : "dark";
}

function isSquareOccupied(square: string, pieces: PieceState[], excludeId?: string) {
  return pieces.some(
    (piece) => piece.virtualSquare === square && (excludeId ? piece.id !== excludeId : true)
  );
}

function isPathClear(from: string, to: string, pieces: PieceState[]) {
  const fromCoords = squareToCoords(from);
  const toCoords = squareToCoords(to);
  const dx = toCoords.fileIndex - fromCoords.fileIndex;
  const dy = toCoords.rankIndex - fromCoords.rankIndex;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const distance = Math.max(Math.abs(dx), Math.abs(dy));

  for (let i = 1; i < distance; i += 1) {
    const file = files[fromCoords.fileIndex + stepX * i];
    const rank = ranks[fromCoords.rankIndex + stepY * i];
    const square = `${file}${rank}`;
    if (isSquareOccupied(square, pieces)) {
      return false;
    }
  }
  return true;
}

function canReachSquare(piece: PieceState, targetSquare: string, pieces: PieceState[]) {
  if (piece.virtualSquare === targetSquare) {
    return false;
  }
  if (isSquareOccupied(targetSquare, pieces)) {
    return false;
  }
  const from = squareToCoords(piece.virtualSquare);
  const to = squareToCoords(targetSquare);
  if (from.fileIndex < 0 || from.rankIndex < 0 || to.fileIndex < 0 || to.rankIndex < 0) {
    return false;
  }
  const dx = to.fileIndex - from.fileIndex;
  const dy = to.rankIndex - from.rankIndex;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  switch (piece.kind) {
    case "Q":
      if (dx === 0 || dy === 0 || absDx === absDy) {
        return isPathClear(piece.virtualSquare, targetSquare, pieces);
      }
      return false;
    case "R":
      if (dx === 0 || dy === 0) {
        return isPathClear(piece.virtualSquare, targetSquare, pieces);
      }
      return false;
    case "B":
      if (absDx === absDy) {
        return isPathClear(piece.virtualSquare, targetSquare, pieces);
      }
      return false;
    case "N":
      return (absDx === 1 && absDy === 2) || (absDx === 2 && absDy === 1);
    default:
      return false;
  }
}

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildPieceKinds(pieceCount: number): PieceKind[] {
  const base: PieceKind[] = ["Q", "R", "B", "N"];
  if (pieceCount === 3) {
    const candidates = base.filter((kind) => kind !== "B");
    if (Math.random() < 0.7) {
      return randomChoice([
        ["Q", "R", randomChoice(["B", "N"])],
        ["Q", "B", "N"],
        ["R", "B", "N"],
      ]);
    }
    return randomChoice([
      ["Q", "R", "B"],
      ["Q", "R", "N"],
      ["Q", "B", "N"],
      ["R", "B", "N"],
    ]);
  }
  if (pieceCount === 4) {
    return ["Q", "R", "B", "N"];
  }
  if (pieceCount === 5) {
    return [...base, randomChoice(["R", "N", "B"])];
  }
  const extras: PieceKind[] = [];
  const counts = new Map<PieceKind, number>([
    ["Q", 1],
    ["R", 1],
    ["B", 1],
    ["N", 1],
  ]);
  while (extras.length < 2) {
    const candidate = randomChoice(["R", "N", "B"]);
    if ((counts.get(candidate) ?? 0) >= 2) {
      continue;
    }
    counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    extras.push(candidate);
  }
  return [...base, ...extras];
}

function generatePlacement(pieceKinds: PieceKind[]): PieceState[] | null {
  const bishopCount = pieceKinds.filter((kind) => kind === "B").length;
  const bishopColors = bishopCount === 2 ? ["light", "dark"].sort(() => Math.random() - 0.5) : [];

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const usedSquares = new Set<string>();
    const pieces: PieceState[] = [];
    const kindCounts = new Map<PieceKind, number>();
    const bishopColorQueue = [...bishopColors];
    let success = true;

    for (const kind of pieceKinds) {
      const nextIndex = (kindCounts.get(kind) ?? 0) + 1;
      kindCounts.set(kind, nextIndex);

      const requiredColor = kind === "B" && bishopColorQueue.length > 0 ? bishopColorQueue.shift() : null;
      const candidates = allSquares.filter((square) => {
        if (usedSquares.has(square)) return false;
        if (requiredColor) return squareColor(square) === requiredColor;
        return true;
      });

      if (candidates.length === 0) {
        success = false;
        break;
      }

      const square = randomChoice(candidates);
      usedSquares.add(square);
      pieces.push({
        id: `${kind}-${nextIndex}-${square}`,
        kind,
        color: "w",
        displayColor: "w",
        displaySquare: square,
        virtualSquare: square,
      });
    }

    if (success) {
      const grouped = new Map<PieceKind, PieceState[]>();
      pieces.forEach((piece) => {
        const list = grouped.get(piece.kind) ?? [];
        list.push(piece);
        grouped.set(piece.kind, list);
      });
      grouped.forEach((group) => {
        const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
        sorted.forEach((piece, index) => {
          piece.displayColor = index === 1 ? "b" : "w";
        });
      });
      return pieces;
    }
  }

  return null;
}

function generateTarget(virtualPieces: PieceState[]) {
  const emptySquares = allSquares.filter((square) => !isSquareOccupied(square, virtualPieces));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const targetSquare = randomChoice(emptySquares);
    const reachable = virtualPieces.filter((piece) => canReachSquare(piece, targetSquare, virtualPieces));
    if (reachable.length === 1) {
      return { targetSquare, correctPieceId: reachable[0].id };
    }
  }
  return null;
}

function buildNewGame(pieceCount: number) {
  const pieceKinds = buildPieceKinds(pieceCount);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pieces = generatePlacement(pieceKinds);
    if (!pieces) continue;
    const target = generateTarget(pieces);
    if (target) {
      return { pieces, ...target };
    }
  }
  return null;
}

export default function IchuckyPage() {
  const [visiblePieces, setVisiblePieces] = useState<PieceState[]>([]);
  const [virtualPieces, setVirtualPieces] = useState<PieceState[]>([]);
  const [targetSquare, setTargetSquare] = useState<string | null>(null);
  const [correctPieceId, setCorrectPieceId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "finished">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [pieceCount, setPieceCount] = useState(4);
  const [history, setHistory] = useState<MoveHistoryItem[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [lastMistake, setLastMistake] = useState<LastMistake | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  const isDev = process.env.NODE_ENV === "development";

  const pieceOptions = useMemo(() => {
    const counts = new Map<PieceKind, number>();
    const bishopCount = visiblePieces.filter((piece) => piece.kind === "B").length;
    return visiblePieces.map((piece) => {
      const index = (counts.get(piece.kind) ?? 0) + 1;
      counts.set(piece.kind, index);
      const icon = pieceIcons[piece.kind][piece.displayColor];
      if (piece.kind === "B" && bishopCount === 2) {
        const label = squareColor(piece.displaySquare) === "light" ? "Слон (світлопольний)" : "Слон (темнопольний)";
        return { id: piece.id, label, icon };
      }
      return {
        id: piece.id,
        label: counts.get(piece.kind)! > 1 ? `${kindLabels[piece.kind]} #${index}` : kindLabels[piece.kind],
        icon,
      };
    });
  }, [visiblePieces]);

  const pieceLabelMap = useMemo(() => {
    return new Map(pieceOptions.map((piece) => [piece.id, piece.label]));
  }, [pieceOptions]);

  const startSession = () => {
    const nextGame = buildNewGame(pieceCount);
    if (!nextGame) {
      setStatus("finished");
      setVisiblePieces([]);
      setVirtualPieces([]);
      setTargetSquare(null);
      setCorrectPieceId(null);
      setMessage("Не вдалося згенерувати завдання, перезапустіть");
      setMessageTone("error");
      return;
    }
    setVisiblePieces(nextGame.pieces);
    setVirtualPieces(nextGame.pieces.map((piece) => ({ ...piece })));
    setTargetSquare(nextGame.targetSquare);
    setCorrectPieceId(nextGame.correctPieceId);
    setStatus("running");
    setMessage(null);
    setMessageTone(null);
    setAttempts(0);
    setCorrect(0);
    setStreak(0);
    setHistory([]);
    setGameOver(false);
    setLastMistake(null);
  };

  const loadLeaderboard = useCallback(async () => {
    try {
      setLeaderboardLoading(true);
      const response = await fetch("/api/student/ichucky/leaderboard?limit=10", {
        method: "GET",
      });
      if (!response.ok) {
        throw new Error("Не вдалося завантажити рейтинг");
      }
      const payload = (await response.json()) as LeaderboardResponse;
      setLeaderboard(payload);
      setLeaderboardError(null);
    } catch (error) {
      setLeaderboardError(error instanceof Error ? error.message : "Не вдалося завантажити рейтинг");
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const logAttempt = async (payload: {
    isCorrect: boolean;
    streakAfter: number;
    piecesCount: number;
    targetSquare: string;
    correctPieceId: string;
    correctPieceLabel: string;
    chosenPieceId: string;
    chosenPieceLabel: string;
  }) => {
    try {
      await fetch("/api/student/ichucky/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Ignore logging errors
    }
  };

  const handlePick = (pieceId: string) => {
    if (status !== "running" || !targetSquare || !correctPieceId || gameOver) {
      return;
    }

    const snapshot = virtualPieces.map((piece) => ({
      id: piece.id,
      label: pieceLabelMap.get(piece.id) ?? piece.id,
      type: piece.kind,
      square: piece.virtualSquare,
    }));
    const correctSnapshot = snapshot.find((piece) => piece.id === correctPieceId);
    const chosenSnapshot = snapshot.find((piece) => piece.id === pieceId);

    setAttempts((prev) => prev + 1);

    if (pieceId === correctPieceId) {
      const nextStreak = streak + 1;
      setCorrect((prev) => prev + 1);
      setStreak((prev) => prev + 1);
      if (correctSnapshot && chosenSnapshot) {
        setHistory((prev) => [
          ...prev,
          {
            stepIndex: prev.length + 1,
            targetSquare,
            correctPieceId: correctSnapshot.id,
            correctPieceLabel: correctSnapshot.label,
            chosenPieceId: chosenSnapshot.id,
            chosenPieceLabel: chosenSnapshot.label,
            isCorrect: true,
            virtualSnapshotBefore: snapshot,
          },
        ]);
        void logAttempt({
          isCorrect: true,
          streakAfter: nextStreak,
          piecesCount: pieceCount,
          targetSquare,
          correctPieceId: correctSnapshot.id,
          correctPieceLabel: correctSnapshot.label,
          chosenPieceId: chosenSnapshot.id,
          chosenPieceLabel: chosenSnapshot.label,
        });
        void loadLeaderboard();
      }

      const updatedVirtual = virtualPieces.map((piece) =>
        piece.id === correctPieceId ? { ...piece, virtualSquare: targetSquare } : piece
      );
      setVirtualPieces(updatedVirtual);

      const nextTarget = generateTarget(updatedVirtual);
      if (!nextTarget) {
        const regenerated = buildNewGame(pieceCount);
        if (!regenerated) {
          setStatus("finished");
          setMessage("Не вдалося згенерувати завдання, перезапустіть");
          setMessageTone("error");
          return;
        }
        setVisiblePieces(regenerated.pieces);
        setVirtualPieces(regenerated.pieces.map((piece) => ({ ...piece })));
        setTargetSquare(regenerated.targetSquare);
        setCorrectPieceId(regenerated.correctPieceId);
        setMessage("Нова позиція згенерована.");
        setMessageTone("success");
        return;
      }
      setTargetSquare(nextTarget.targetSquare);
      setCorrectPieceId(nextTarget.correctPieceId);
      setMessage("Правильно!");
      setMessageTone("success");
      return;
    }

    setStreak(0);
    setStatus("finished");
    setMessage("Помилка. Спроба завершена.");
    setMessageTone("error");
    setGameOver(true);
    if (correctSnapshot && chosenSnapshot) {
      setHistory((prev) => [
        ...prev,
        {
          stepIndex: prev.length + 1,
          targetSquare,
          correctPieceId: correctSnapshot.id,
          correctPieceLabel: correctSnapshot.label,
          chosenPieceId: chosenSnapshot.id,
          chosenPieceLabel: chosenSnapshot.label,
          isCorrect: false,
          virtualSnapshotBefore: snapshot,
        },
      ]);
      void logAttempt({
        isCorrect: false,
        streakAfter: 0,
        piecesCount: pieceCount,
        targetSquare,
        correctPieceId: correctSnapshot.id,
        correctPieceLabel: correctSnapshot.label,
        chosenPieceId: chosenSnapshot.id,
        chosenPieceLabel: chosenSnapshot.label,
      });
      void loadLeaderboard();
      setLastMistake({
        target: targetSquare,
        correctPieceId: correctSnapshot.id,
        correctPieceLabel: correctSnapshot.label,
        correctFrom: correctSnapshot.square,
        chosenPieceId: chosenSnapshot.id,
        chosenPieceLabel: chosenSnapshot.label,
        chosenFrom: chosenSnapshot.square,
        virtualPiecesSnapshot: snapshot,
      });
    } else {
      setLastMistake(null);
    }
  };

  return (
    <div className="max-w-6xl space-y-6">
      <Card>
        <CardHeader className="py-4">
          <CardTitle>iChucky</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex flex-col items-start">
              <div className="w-full" style={{ width: "min(68vh, 100%)" }}>
                <div className="grid grid-cols-[32px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_28px] items-stretch">
                  <div className="grid grid-rows-8 select-none pointer-events-none text-sm md:text-base font-semibold text-slate-600">
                    {RANKS.map((rank) => (
                      <div key={rank} className="flex items-center justify-center">
                        {rank}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0">
                    <div className="aspect-square w-full">
                      <StaticBoard
                        className="w-full h-full"
                        squareClassName="text-3xl sm:text-4xl lg:text-5xl"
                        pieceClassName="text-neutral-900 drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
                        pieces={visiblePieces.map((piece) => ({
                          id: piece.id,
                          square: piece.displaySquare,
                          kind: piece.kind,
                          color: piece.displayColor,
                        }))}
                        highlightSquares={targetSquare ? [targetSquare] : []}
                        showCoords={false}
                      />
                    </div>
                  </div>
                  <div />
                  <div className="grid grid-cols-8 select-none pointer-events-none text-sm md:text-base font-semibold text-slate-600">
                    {FILES.map((file) => (
                      <div key={file} className="flex items-center justify-center">
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <CardDescription>Вибери фігуру, яка може потрапити на цільове поле</CardDescription>
              <div className="flex flex-wrap gap-3 text-sm text-[hsl(var(--muted-foreground))]">
                <div>Спроби: {attempts}</div>
                <div>Правильні: {correct}</div>
                <div>Серія: {streak}</div>
              </div>
              <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Рекорд: {leaderboard?.me.bestStreak ?? 0}
              </div>
              <div>
                <div className="text-sm font-semibold text-[hsl(var(--foreground))]">Топ 10</div>
                {leaderboardLoading && (
                  <div className="text-sm text-[hsl(var(--muted-foreground))]">Завантаження...</div>
                )}
                {!leaderboardLoading && leaderboardError && (
                  <div className="text-sm text-[hsl(var(--destructive))]">
                    Не вдалося завантажити рейтинг
                  </div>
                )}
                {!leaderboardLoading && !leaderboardError && (
                  <ol className="mt-2 space-y-1 text-sm text-[hsl(var(--foreground))]">
                    {(leaderboard?.top ?? []).map((row, index) => (
                      <li key={row.userId}>
                        {index + 1}. {row.label} — {row.bestStreak}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Кількість фігур
                </span>
                <div className="inline-flex rounded-lg border border-[hsl(var(--border))] overflow-hidden">
                  {[3, 4, 5, 6].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setPieceCount(count)}
                      aria-pressed={pieceCount === count}
                      className={[
                        "px-3 py-1.5 text-sm font-semibold transition-colors",
                        pieceCount === count
                          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                          : "bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
                      ].join(" ")}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={startSession}>
                {status === "idle" ? "Почати" : "Перезапустити"}
              </Button>
              <div className="text-base font-semibold text-[hsl(var(--foreground))]">Обери фігуру</div>
              <div className="flex flex-wrap gap-3">
                {pieceOptions.map((piece) => (
                  <button
                    key={piece.id}
                    type="button"
                    onClick={() => handlePick(piece.id)}
                    disabled={status !== "running"}
                    aria-label={piece.label}
                    title={piece.label}
                    className={[
                      "h-14 w-14 rounded-xl border-2 text-3xl transition-colors shadow-sm",
                      status === "running"
                        ? "border-[hsl(var(--border))] bg-white hover:bg-[#f7f2df]"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
                    ].join(" ")}
                  >
                    {piece.icon}
                  </button>
                ))}
              </div>
              {message && (
                <div
                  className={[
                    "rounded-md px-3 py-2 text-sm font-semibold",
                    messageTone === "success"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
                      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
                  ].join(" ")}
                >
                  {message}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {gameOver && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Вправа завершена</CardTitle>
              <CardDescription>Підсумок і розбір останньої помилки</CardDescription>
            </div>
            <Button onClick={startSession}>Почати заново</Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-sm font-medium text-[hsl(var(--foreground))]">
              Серія: {history.filter((item) => item.isCorrect).length}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-[hsl(var(--foreground))]">Історія ходів</div>
              {history.length === 0 ? (
                <div className="text-sm text-[hsl(var(--muted-foreground))]">
                  Немає правильних ходів.
                </div>
              ) : (
                <ul className="space-y-1 text-sm text-[hsl(var(--foreground))]">
                  {history.map((item) => (
                    <li key={`${item.stepIndex}-${item.correctPieceId}`}>
                      #{item.stepIndex}: Ціль {item.targetSquare} — правильно: {item.correctPieceLabel} — ти вибрав:{" "}
                      {item.chosenPieceLabel} — {item.isCorrect ? "✅" : "❌"}
                    </li>
                  ))}
                </ul>
              )}
              {lastMistake && (
                <div className="mt-3 rounded-md border border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--foreground))]">
                  <div className="font-medium">Остання помилка</div>
                  <div>
                    Ціль: {lastMistake.target}. Потрібно було: {lastMistake.correctPieceLabel} (
                    {lastMistake.correctFrom} → {lastMistake.target}). Ти вибрав:{" "}
                    {lastMistake.chosenPieceLabel} ({lastMistake.chosenFrom}).
                  </div>
                </div>
              )}
            </div>

            {lastMistake && (
              <div className="space-y-3">
                <div className="text-sm font-medium text-[hsl(var(--foreground))]">Діаграма помилки</div>
                <div className="relative inline-block">
                  <StaticBoard
                    squareClassName="h-12 w-12 text-2xl sm:h-14 sm:w-14 sm:text-3xl"
                    pieces={lastMistake.virtualPiecesSnapshot.map((piece) => ({
                      id: piece.id,
                      square: piece.square,
                      kind: piece.type as PieceKind,
                      color: piece.id === lastMistake.correctPieceId
                        ? (visiblePieces.find((p) => p.id === piece.id)?.displayColor ?? "w")
                        : (visiblePieces.find((p) => p.id === piece.id)?.displayColor ?? "w"),
                    }))}
                    highlightSquares={[lastMistake.target]}
                    showCoords
                  />
                  <svg
                    className="absolute inset-0 pointer-events-none"
                    viewBox="0 0 8 8"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <marker
                        id="arrowhead"
                        markerWidth="0.4"
                        markerHeight="0.4"
                        refX="0.3"
                        refY="0.2"
                        orient="auto"
                      >
                        <polygon points="0 0, 0.4 0.2, 0 0.4" fill="#db2777" />
                      </marker>
                      <marker
                        id="arrowhead-secondary"
                        markerWidth="0.4"
                        markerHeight="0.4"
                        refX="0.3"
                        refY="0.2"
                        orient="auto"
                      >
                        <polygon points="0 0, 0.4 0.2, 0 0.4" fill="#2563eb" />
                      </marker>
                    </defs>
                    <rect
                      x={squareToSvg(lastMistake.target).x}
                      y={squareToSvg(lastMistake.target).y}
                      width="1"
                      height="1"
                      fill="rgba(219, 39, 119, 0.2)"
                    />
                    <line
                      x1={squareToSvg(lastMistake.correctFrom).x + 0.5}
                      y1={squareToSvg(lastMistake.correctFrom).y + 0.5}
                      x2={squareToSvg(lastMistake.target).x + 0.5}
                      y2={squareToSvg(lastMistake.target).y + 0.5}
                      stroke="#db2777"
                      strokeWidth="0.1"
                      markerEnd="url(#arrowhead)"
                    />
                    <line
                      x1={squareToSvg(lastMistake.chosenFrom).x + 0.5}
                      y1={squareToSvg(lastMistake.chosenFrom).y + 0.5}
                      x2={squareToSvg(lastMistake.target).x + 0.5}
                      y2={squareToSvg(lastMistake.target).y + 0.5}
                      stroke="#2563eb"
                      strokeWidth="0.08"
                      strokeDasharray="0.15 0.15"
                      markerEnd="url(#arrowhead-secondary)"
                    />
                  </svg>
                </div>
                <div className="text-sm text-[hsl(var(--foreground))]">
                  Потрібно було: {lastMistake.correctPieceLabel} ({lastMistake.correctFrom} →{" "}
                  {lastMistake.target}). Ти вибрав: {lastMistake.chosenPieceLabel} (
                  {lastMistake.chosenFrom}).
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isDev && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Діагностика (dev)</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowDebug((prev) => !prev)}>
              {showDebug ? "Сховати" : "Показати"}
            </Button>
          </CardHeader>
          {showDebug && (
            <CardContent className="space-y-3 text-sm">
              <div>
                <div className="font-medium">Ціль</div>
                <div className="text-[hsl(var(--muted-foreground))]">
                  {targetSquare ?? "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Правильна фігура</div>
                <div className="text-[hsl(var(--muted-foreground))]">
                  {correctPieceId ? `${correctPieceId} (${pieceLabelMap.get(correctPieceId) ?? "—"})` : "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Віртуальні фігури</div>
                <ul className="space-y-1 text-[hsl(var(--muted-foreground))]">
                  {virtualPieces.map((piece) => (
                    <li key={piece.id}>
                      {piece.id} · {kindLabels[piece.kind]} · display {piece.displaySquare} · virtual{" "}
                      {piece.virtualSquare}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
