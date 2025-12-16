"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Student = {
  id: string;
  nickname: string;
  platform: "lichess" | "chesscom";
  handle: string;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  rapidRating: number | null;
  blitzRating: number | null;
  puzzlesSolved24h: number;
  puzzleRating: number | null;
  homeworkCompletionPct: number;
  lastActiveLabel: string;
};

type SortKey =
  | "index"
  | "nickname"
  | "platform"
  | "rapid24h"
  | "rapid7d"
  | "blitz24h"
  | "blitz7d"
  | "rapidRating"
  | "blitzRating"
  | "puzzles24h"
  | "puzzleRating"
  | "homeworkPct"
  | "lastActive";

export default function CoachDashboardPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [nicknameInput, setNicknameInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Fetch students from Supabase on mount
  useEffect(() => {
    async function fetchStudents() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("profiles")
          .select("*, platform_connections(*), stats_snapshots(*)")
          .eq("role", "student");

        if (error) {
          console.error("Error fetching students:", error);
          return;
        }

        if (!data) return;

        // Map DB results to Student type
        const mappedStudents: Student[] = data.map((profile: any) => {
          // Get platform connection (use first one, default to lichess)
          const platformConn = profile.platform_connections?.[0];
          const platform = (platformConn?.platform || "lichess") as "lichess" | "chesscom";
          const handle = platformConn?.platform_username || profile.full_name || profile.name || "";

          // Get latest stats snapshot (sort by created_at desc)
          const statsSnapshots = profile.stats_snapshots || [];
          const latestStats = statsSnapshots.length > 0
            ? [...statsSnapshots].sort((a: any, b: any) => {
                const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
                const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
                return dateB - dateA;
              })[0]
            : null;

          return {
            id: profile.id,
            nickname: profile.full_name || profile.name || "Unnamed",
            platform,
            handle,
            rapidGames24h: latestStats?.games_played_24h || 0,
            rapidGames7d: latestStats?.games_played_7d || 0,
            blitzGames24h: 0, // TODO: Split from total games if needed
            blitzGames7d: 0, // TODO: Split from total games if needed
            rapidRating: latestStats?.rating_rapid ?? null,
            blitzRating: latestStats?.rating_blitz ?? null,
            puzzlesSolved24h: 0,
            puzzleRating: latestStats?.puzzle_rating ?? null,
            homeworkCompletionPct: 0,
            lastActiveLabel: "—",
          };
        });

        setStudents(mappedStudents);
      } catch (err) {
        console.error("Error loading students:", err);
      }
    }

    fetchStudents();
  }, []);

  const handleAdd = async () => {
    const trimmedNickname = nicknameInput.trim();
    
    // Validate non-empty
    if (!trimmedNickname) {
      setErrorMsg("Nickname cannot be empty");
      return;
    }

    // Clear error
    setErrorMsg(null);
    setIsAdding(true);

    try {
      const response = await fetch(
        `/api/player-lookup?username=${encodeURIComponent(trimmedNickname)}`
      );

      if (response.ok) {
        const data = await response.json();
        const newRows: Student[] = data.rows || [];
        
        // Filter out duplicates by (platform + handle) case-insensitive
        const filteredRows = newRows.filter((row) => {
          const isDuplicate = students.some(
            (s) =>
              s.platform === row.platform &&
              s.handle.toLowerCase() === row.handle.toLowerCase()
          );
          return !isDuplicate;
        });

        if (filteredRows.length === 0) {
          setErrorMsg("All accounts for this nickname already exist");
        } else {
          // Sort: lichess first, then chesscom
          const sortedRows = filteredRows.sort((a, b) => {
            if (a.platform === "lichess" && b.platform === "chesscom") return -1;
            if (a.platform === "chesscom" && b.platform === "lichess") return 1;
            return 0;
          });
          
          // Prepend to the beginning of the list
          setStudents([...sortedRows, ...students]);
          setNicknameInput("");
        }
      } else {
        const errorData = await response.json();
        setErrorMsg(errorData.error || "Failed to lookup player");
      }
    } catch (error) {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleClearTable = () => {
    setStudents([]);
    setErrorMsg(null);
  };

  const handleDelete = (id: string) => {
    setStudents(students.filter((student) => student.id !== id));
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedStudents = useMemo(() => {
    const sorted = [...students];

    if (sortKey === "index") {
      // Keep insertion order (already sorted)
      return sortDir === "asc" ? sorted : sorted.reverse();
    }

    sorted.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      let isString = false;

      switch (sortKey) {
        case "nickname":
          aVal = a.nickname.toLowerCase();
          bVal = b.nickname.toLowerCase();
          isString = true;
          break;
        case "platform":
          aVal = a.platform.toLowerCase();
          bVal = b.platform.toLowerCase();
          isString = true;
          break;
        case "rapid24h":
          aVal = a.rapidGames24h;
          bVal = b.rapidGames24h;
          break;
        case "rapid7d":
          aVal = a.rapidGames7d;
          bVal = b.rapidGames7d;
          break;
        case "blitz24h":
          aVal = a.blitzGames24h;
          bVal = b.blitzGames24h;
          break;
        case "blitz7d":
          aVal = a.blitzGames7d;
          bVal = b.blitzGames7d;
          break;
        case "rapidRating":
          aVal = a.rapidRating;
          bVal = b.rapidRating;
          break;
        case "blitzRating":
          aVal = a.blitzRating;
          bVal = b.blitzRating;
          break;
        case "puzzles24h":
          aVal = a.puzzlesSolved24h;
          bVal = b.puzzlesSolved24h;
          break;
        case "puzzleRating":
          aVal = a.puzzleRating;
          bVal = b.puzzleRating;
          break;
        case "homeworkPct":
          aVal = a.homeworkCompletionPct;
          bVal = b.homeworkCompletionPct;
          break;
        case "lastActive":
          aVal = (a.lastActiveLabel || "").toLowerCase();
          bVal = (b.lastActiveLabel || "").toLowerCase();
          isString = true;
          break;
        default:
          return 0;
      }

      if (isString) {
        // String comparison (case-insensitive, stable)
        if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
        return 0;
      } else {
        // Numeric comparison (null/undefined/"—" go to bottom)
        const aMissing = aVal === null || aVal === undefined || aVal === "—";
        const bMissing = bVal === null || bVal === undefined || bVal === "—";

        if (aMissing && bMissing) return 0;
        if (aMissing) return 1; // a goes to bottom
        if (bMissing) return -1; // b goes to bottom

        // Both are numbers, compare normally
        if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
        return 0;
      }
    });

    return sorted;
  }, [students, sortKey, sortDir]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Coach Dashboard</h1>

      <div className="mb-6 p-4 border rounded-lg bg-white">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">
              Nickname
            </label>
            <input
              type="text"
              value={nicknameInput}
              onChange={(e) => {
                setNicknameInput(e.target.value);
                setErrorMsg(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAdd();
                }
              }}
              className="w-full border rounded-md px-3 py-2 text-sm"
              placeholder="Enter nickname"
            />
            {errorMsg && (
              <p className="text-red-600 text-xs mt-1">{errorMsg}</p>
            )}
          </div>
          <button
            onClick={handleAdd}
            disabled={isAdding}
            className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={handleClearTable}
            className="px-4 py-2 border rounded-md text-sm font-semibold hover:bg-gray-50"
          >
            Clear table
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("index")}
              >
                #{sortKey === "index" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("nickname")}
              >
                Nickname{sortKey === "nickname" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("platform")}
              >
                Platform{sortKey === "platform" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("rapid24h")}
              >
                Rapid 24h{sortKey === "rapid24h" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("rapid7d")}
              >
                Rapid 7d{sortKey === "rapid7d" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("blitz24h")}
              >
                Blitz 24h{sortKey === "blitz24h" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("blitz7d")}
              >
                Blitz 7d{sortKey === "blitz7d" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("rapidRating")}
              >
                Rapid rating{sortKey === "rapidRating" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("blitzRating")}
              >
                Blitz rating{sortKey === "blitzRating" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("puzzles24h")}
              >
                Puzzles 24h{sortKey === "puzzles24h" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("puzzleRating")}
              >
                Puzzle rating{sortKey === "puzzleRating" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-center font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("homeworkPct")}
              >
                Homework %{sortKey === "homeworkPct" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th
                className="border border-gray-300 px-3 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("lastActive")}
              >
                Last active{sortKey === "lastActive" && (
                  <span className="ml-1 text-xs">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map((student, index) => (
              <tr key={student.id} className="hover:bg-gray-50">
                <td className="border border-gray-300 px-3 py-2 text-center">
                  {index + 1}
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  {student.nickname}
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  {student.platform === "lichess"
                    ? `Lichess: ${student.handle}`
                    : `Chess.com: ${student.handle}`}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.rapidGames24h}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.rapidGames7d}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.blitzGames24h}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.blitzGames7d}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.rapidRating !== null ? student.rapidRating : "—"}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.blitzRating !== null ? student.blitzRating : "—"}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.puzzlesSolved24h}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.puzzleRating !== null ? student.puzzleRating : "—"}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-right">
                  {student.homeworkCompletionPct}%
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  {student.lastActiveLabel}
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
                  <button
                    onClick={() => handleDelete(student.id)}
                    className="text-red-600 hover:text-red-800 hover:underline text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
