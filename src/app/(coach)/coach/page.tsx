"use client";

import { useState } from "react";

type Student = {
  id: string;
  nickname: string;
  lichessHandle: string | null;
  chesscomHandle: string | null;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  rapidRating: number | null;
  blitzRating: number | null;
  puzzlesSolved24h: number;
  puzzlesSolved7d: number;
  puzzleRating: number | null;
  homeworkCompletionPct: number;
  lastActiveLabel: string;
};

export default function CoachDashboardPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [nicknameInput, setNicknameInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmedNickname = nicknameInput.trim();
    
    // Validate non-empty
    if (!trimmedNickname) {
      setErrorMsg("Nickname cannot be empty");
      return;
    }

    // Check for duplicates (case-insensitive)
    const isDuplicate = students.some(
      (s) => s.nickname.toLowerCase() === trimmedNickname.toLowerCase()
    );
    
    if (isDuplicate) {
      setErrorMsg("Nickname already exists");
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
        const newStudent = await response.json();
        setStudents([...students, newStudent]);
        setNicknameInput("");
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
              <th className="border border-gray-300 px-3 py-2 text-left font-semibold">
                Nickname
              </th>
              <th className="border border-gray-300 px-3 py-2 text-left font-semibold">
                Platforms
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Rapid games
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Blitz games
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Ratings
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Puzzles
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Homework %
              </th>
              <th className="border border-gray-300 px-3 py-2 text-left font-semibold">
                Last active
              </th>
              <th className="border border-gray-300 px-3 py-2 text-center font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id} className="hover:bg-gray-50">
                <td className="border border-gray-300 px-3 py-2">
                  {student.nickname}
                </td>
                <td className="border border-gray-300 px-3 py-2">
                  <div className="flex flex-col gap-1">
                    <span>
                      Lichess:{" "}
                      {student.lichessHandle !== null
                        ? student.lichessHandle
                        : "—"}
                    </span>
                    <span>
                      Chess.com:{" "}
                      {student.chesscomHandle !== null
                        ? student.chesscomHandle
                        : "—"}
                    </span>
                  </div>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
                  <div className="flex flex-col gap-1">
                    <span>{student.rapidGames24h} (24h)</span>
                    <span>{student.rapidGames7d} (7d)</span>
                  </div>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
                  <div className="flex flex-col gap-1">
                    <span>{student.blitzGames24h} (24h)</span>
                    <span>{student.blitzGames7d} (7d)</span>
                  </div>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
                  <div className="flex flex-col gap-1">
                    <span>
                      Rapid:{" "}
                      {student.rapidRating !== null ? student.rapidRating : "—"}
                    </span>
                    <span>
                      Blitz:{" "}
                      {student.blitzRating !== null ? student.blitzRating : "—"}
                    </span>
                  </div>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
                  <div className="flex flex-col gap-1">
                    <span>24h: {student.puzzlesSolved24h}</span>
                    <span>7d: {student.puzzlesSolved7d}</span>
                    <span>
                      Rating:{" "}
                      {student.puzzleRating !== null
                        ? student.puzzleRating
                        : "—"}
                    </span>
                  </div>
                </td>
                <td className="border border-gray-300 px-3 py-2 text-center">
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
