import React from "react";

export type StaticBoardPiece = {
  id: string;
  square: string;
  kind: "K" | "Q" | "R" | "B" | "N" | "P";
  color: "w" | "b";
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks = [8, 7, 6, 5, 4, 3, 2, 1];

const pieceSymbols: Record<StaticBoardPiece["color"], Record<StaticBoardPiece["kind"], string>> = {
  w: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙" },
  b: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" },
};

type StaticBoardProps = {
  pieces: StaticBoardPiece[];
  highlightSquares?: string[];
  showCoords?: boolean;
  className?: string;
  squareClassName?: string;
  pieceClassName?: string;
};

export function StaticBoard({
  pieces,
  highlightSquares = [],
  showCoords = false,
  className,
  squareClassName,
  pieceClassName,
}: StaticBoardProps) {
  const pieceBySquare = new Map<string, StaticBoardPiece>();
  pieces.forEach((piece) => {
    pieceBySquare.set(piece.square, piece);
  });

  return (
    <div
      className={[
        "inline-block border border-[hsl(var(--border))] rounded-lg overflow-hidden",
        className ?? "",
      ].join(" ")}
    >
      <div className="grid grid-cols-8 grid-rows-8 w-full h-full">
        {ranks.map((rank) =>
          files.map((file, fileIndex) => {
            const square = `${file}${rank}`;
            const isLight = (fileIndex + rank) % 2 === 0;
            const piece = pieceBySquare.get(square);
            const isHighlighted = highlightSquares.includes(square);

            return (
              <div
                key={square}
                className={[
                  "relative flex items-center justify-center aspect-square w-full h-full text-2xl sm:text-3xl",
                  isLight ? "bg-[#EEEED2]" : "bg-[#769656]",
                  isHighlighted ? "ring-4 ring-fuchsia-400/80 ring-inset" : "",
                  squareClassName ?? "",
                ].join(" ")}
              >
                {piece ? (
                  <span
                    className={[
                      "drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)] text-neutral-900",
                      pieceClassName ?? "",
                    ].join(" ")}
                  >
                    {pieceSymbols[piece.color][piece.kind]}
                  </span>
                ) : (
                  ""
                )}
                {showCoords && fileIndex === 0 && (
                  <span className="absolute left-1 top-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                    {rank}
                  </span>
                )}
                {showCoords && rank === 1 && (
                  <span className="absolute right-1 bottom-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                    {file}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

