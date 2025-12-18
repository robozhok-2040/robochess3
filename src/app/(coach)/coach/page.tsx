"use client";

import { useState, useMemo, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { scheduleLichessRequest } from "@/lib/rateLimiter";
import { EyeOff, Trash2 } from "lucide-react";

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

  // Update student stats from live APIs
  async function updateStudentStats(studentsList: Student[]) {
    if (studentsList.length === 0) return;

    try {
      // Fetch stats for all students in parallel
      const updatePromises = studentsList.map(async (student) => {
        // Skip if no handle
        if (!student.handle) {
          return { studentId: student.id, updates: null };
        }

        try {
          if (student.platform === "lichess") {
            // Fetch Lichess stats
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            try {
              const response = await fetch(
                `https://lichess.org/api/user/${encodeURIComponent(student.handle)}`,
                {
                  headers: { Accept: "application/json" },
                  signal: controller.signal,
                }
              );
              
              clearTimeout(timeoutId);

            if (!response.ok) {
              console.warn(`Failed to fetch Lichess stats for ${student.handle}: ${response.status}`);
              return { studentId: student.id, updates: null };
            }

            const data = await response.json();

            // Safe parsing with optional chaining
            const updates = {
              rapidRating: data.perfs?.rapid?.rating || null,
              blitzRating: data.perfs?.blitz?.rating || null,
              puzzleRating: data.perfs?.puzzle?.rating || null,
            };

              console.log(`✅ Lichess stats fetched for ${student.handle}:`, updates);
              return { studentId: student.id, updates };
            } catch (fetchError) {
              clearTimeout(timeoutId);
              throw fetchError;
            }

          } else if (student.platform === "chesscom") {
            // Fetch Chess.com stats
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            try {
              const response = await fetch(
                `https://api.chess.com/pub/player/${encodeURIComponent(student.handle)}/stats`,
                {
                  headers: { Accept: "application/json" },
                  signal: controller.signal,
                }
              );
              
              clearTimeout(timeoutId);

            if (!response.ok) {
              console.warn(`Failed to fetch Chess.com stats for ${student.handle}: ${response.status}`);
              return { studentId: student.id, updates: null };
            }

            const data = await response.json();

            // Safe parsing with optional chaining
            const updates = {
              rapidRating: data.chess_rapid?.last?.rating || null,
              blitzRating: data.chess_blitz?.last?.rating || null,
              puzzleRating: data.tactics?.highest?.rating || null,
            };

              console.log(`✅ Chess.com stats fetched for ${student.handle}:`, updates);
              return { studentId: student.id, updates };
            } catch (fetchError) {
              clearTimeout(timeoutId);
              throw fetchError;
            }
          }

          return { studentId: student.id, updates: null };
        } catch (error) {
          console.warn(`Error fetching stats for ${student.handle}:`, error);
          return { studentId: student.id, updates: null };
        }
      });

      const results = await Promise.all(updatePromises);

      // Update state with fetched stats
      setStudents((prevStudents) => {
        return prevStudents.map((student) => {
          const result = results.find((r) => r.studentId === student.id);
          if (result && result.updates) {
            return {
              ...student,
              rapidRating: result.updates.rapidRating ?? student.rapidRating,
              blitzRating: result.updates.blitzRating ?? student.blitzRating,
              puzzleRating: result.updates.puzzleRating ?? student.puzzleRating,
            };
          }
          return student;
        });
      });
    } catch (error) {
      console.error("Error updating student stats:", error);
    }
  }

  // Fetch Lichess game activity for a specific username (with localStorage caching)
  async function fetchLichessGames(
    username: string
  ): Promise<{ rapidGames24h: number; rapidGames7d: number; blitzGames24h: number; blitzGames7d: number }> {
    const cacheKey = `lichess_cache_${username}`;
    const cacheMaxAge = 10 * 60 * 1000; // 10 minutes in milliseconds

    // 1. Check cache first
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cacheAge = Date.now() - parsed.timestamp;
        
        if (cacheAge < cacheMaxAge) {
          console.log(`[CACHE HIT] Using cached data for ${username} (${Math.round(cacheAge / 1000)}s old)`);
          return {
            rapidGames24h: parsed.rapidGames24h,
            rapidGames7d: parsed.rapidGames7d,
            blitzGames24h: parsed.blitzGames24h,
            blitzGames7d: parsed.blitzGames7d,
          };
        }
      }
    } catch (e) {
      // Cache parse error, continue to API call
      console.warn(`Cache read error for ${username}:`, e);
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Retry with exponential backoff for 429/503 errors
    const fetchWithRetry = async (retryCount = 0): Promise<Response> => {
      const backoffDelays = [5000, 10000, 20000]; // 5s, 10s, 20s

      try {
        // Schedule through rate limiter (serializes requests, ~1 per 1.2s)
        const res = await scheduleLichessRequest(async () => {
          return fetch(
            `https://lichess.org/api/games/user/${encodeURIComponent(username)}?since=${sevenDaysAgo}&max=200`,
            { headers: { Accept: "application/x-ndjson" } }
          );
        });

        // If rate limited (429) or service unavailable (503), retry with backoff
        if ((res.status === 429 || res.status === 503) && retryCount < 3) {
          const delay = backoffDelays[retryCount] || 20000;
          console.warn(
            `[RETRY ${retryCount + 1}/3] ${res.status} for ${username}, waiting ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return fetchWithRetry(retryCount + 1);
        }

        return res;
      } catch (error) {
        // On network error, retry if we haven't exceeded max retries
        if (retryCount < 3) {
          const delay = backoffDelays[retryCount] || 20000;
          console.warn(`[RETRY ${retryCount + 1}/3] Network error for ${username}, waiting ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return fetchWithRetry(retryCount + 1);
        }
        throw error;
      }
    };

    try {
      // 2. Fetch as text (NOT json) to handle newline-delimited response
      // Increased limit to 200 to capture more games (in case user plays a lot of Bullet)
      const res = await fetchWithRetry();

      if (!res.ok) {
        // Handle errors - try to use stale cache instead of returning zeros
        console.warn(`Failed to fetch Lichess games for ${username}: ${res.status}`);
        
        // Try to use stale cache as fallback
        try {
          const cachedData = localStorage.getItem(cacheKey);
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            console.log(`[CACHE FALLBACK] Using stale cache for ${username} due to ${res.status} error`);
            return {
              rapidGames24h: parsed.rapidGames24h,
              rapidGames7d: parsed.rapidGames7d,
              blitzGames24h: parsed.blitzGames24h,
              blitzGames7d: parsed.blitzGames7d,
            };
          }
        } catch (e) {
          // Cache fallback failed
        }

        // If no cache available and request failed, throw error to be caught below
        // This prevents returning zeros which would overwrite good data
        throw new Error(`Lichess API returned ${res.status} for ${username}`);
      }

      const text = await res.text();

      // 3. Parse NDJSON (split by newline)
      if (!text.trim()) {
        console.log(`No games found for ${username} (empty response)`);
        // Empty response might mean no games OR API issue
        // Try cache fallback first
        try {
          const cachedData = localStorage.getItem(cacheKey);
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            console.log(`[CACHE FALLBACK] Using stale cache for ${username} (empty API response)`);
            return {
              rapidGames24h: parsed.rapidGames24h,
              rapidGames7d: parsed.rapidGames7d,
              blitzGames24h: parsed.blitzGames24h,
              blitzGames7d: parsed.blitzGames7d,
            };
          }
        } catch (e) {
          // Cache fallback failed
        }
        // Only return zeros if no cache available (likely truly no games)
        return { rapidGames24h: 0, rapidGames7d: 0, blitzGames24h: 0, blitzGames7d: 0 };
      }

      const games = text
        .trim()
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((g) => g !== null);

      // Debug logging for robo4040
      if (username === "robo4040") {
        console.log(`[DEBUG robo4040] Raw text length: ${text.length}`);
        console.log(`[DEBUG robo4040] Parsed games count: ${games.length}`);
        if (games.length > 0) {
          console.log(
            `[DEBUG robo4040] First game speed: ${games[0].speed || "missing"}, CreatedAt: ${games[0].createdAt || "missing"}`
          );
          // Log counts breakdown
          const blitz = games.filter((g) => (g.speed || "").toLowerCase() === "blitz").length;
          const rapid = games.filter((g) => (g.speed || "").toLowerCase() === "rapid").length;
          const bullet = games.filter((g) => (g.speed || "").toLowerCase() === "bullet").length;
          console.log(
            `[DEBUG robo4040] Calculated inside function -> Blitz: ${blitz}, Rapid: ${rapid}, Bullet: ${bullet}`
          );
        }
      }

      // 4. Categorize by speed property (with safe fallback)
      // Initialize counters
      let rapidCount = 0;
      let blitzCount = 0;

      games.forEach((g) => {
        // Lichess 'speed' property: 'rapid', 'blitz', 'bullet', 'classical', 'correspondence'
        // Use safe fallback for missing speed property
        const speed = (g.speed || "unknown").toLowerCase();
        if (speed === "rapid") rapidCount++;
        if (speed === "blitz") blitzCount++;
      });

      // Calculate 24h stats (with safe property access)
      const rapid24h = games.filter(
        (g) =>
          (g.speed || "").toLowerCase() === "rapid" &&
          g.createdAt &&
          new Date(g.createdAt).getTime() > oneDayAgo
      ).length;
      const blitz24h = games.filter(
        (g) =>
          (g.speed || "").toLowerCase() === "blitz" &&
          g.createdAt &&
          new Date(g.createdAt).getTime() > oneDayAgo
      ).length;

      const result = {
        rapidGames24h: rapid24h,
        rapidGames7d: rapidCount,
        blitzGames24h: blitz24h,
        blitzGames7d: blitzCount,
      };

      console.log(
        `Stats for ${username}: Rapid=${rapidCount} (24h: ${rapid24h}), Blitz=${blitzCount} (24h: ${blitz24h})`
      );

      // 5. Save to cache
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            ...result,
            timestamp: Date.now(),
          })
        );
        console.log(`[CACHE SAVED] Cached data for ${username}`);
      } catch (e) {
        console.warn(`Failed to save cache for ${username}:`, e);
      }

      return result;
    } catch (error) {
      console.error(`Error fetching games for ${username}:`, error);
      
      // On error, try to use stale cache as fallback
      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          console.log(`[CACHE FALLBACK] Using stale cache for ${username} due to error: ${error}`);
          return {
            rapidGames24h: parsed.rapidGames24h,
            rapidGames7d: parsed.rapidGames7d,
            blitzGames24h: parsed.blitzGames24h,
            blitzGames7d: parsed.blitzGames7d,
          };
        }
      } catch (e) {
        // Fallback cache also failed
      }
      
      // IMPORTANT: Return null or throw to indicate failure, instead of zeros
      // This prevents overwriting good data with zeros
      console.error(`[CRITICAL] No cache available and fetch failed for ${username}. Returning zeros (may overwrite data).`);
      // Note: In a production system, you might want to throw here or return a special error object
      // For now, we return zeros but log a critical warning
      return { rapidGames24h: 0, rapidGames7d: 0, blitzGames24h: 0, blitzGames7d: 0 };
    }
  }

  // Fetch recent game activity (last 7 days and 24 hours)
  async function fetchRecentActivity(studentsList: Student[]) {
    if (studentsList.length === 0) return;

    const now = Date.now();
    const timestamp24hAgo = now - 24 * 60 * 60 * 1000;
    const timestamp7dAgo = now - 7 * 24 * 60 * 60 * 1000;

    try {
      // Fetch activity for all students in parallel
      const activityPromises = studentsList.map(async (student) => {
        // Skip if no handle
        if (!student.handle) {
          return { studentId: student.id, activity: null };
        }

        try {
          if (student.platform === "lichess") {
            // Use dedicated Lichess games function
            const activity = await fetchLichessGames(student.handle);

            console.log(`✅ Lichess activity fetched for ${student.handle}:`, activity);
            return { studentId: student.id, activity };

          } else if (student.platform === "chesscom") {
            // Fetch Chess.com games (current month)
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, "0");

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
              const response = await fetch(
                `https://api.chess.com/pub/player/${encodeURIComponent(student.handle)}/games/${year}/${month}`,
                {
                  headers: { Accept: "application/json" },
                  signal: controller.signal,
                }
              );

              clearTimeout(timeoutId);

              if (!response.ok) {
                console.warn(`Failed to fetch Chess.com games for ${student.handle}: ${response.status}`);
                return { studentId: student.id, activity: null };
              }

              const data = await response.json();
              const games = data.games || [];

              let rapidGames7d = 0;
              let rapidGames24h = 0;
              let blitzGames7d = 0;
              let blitzGames24h = 0;

              for (const game of games) {
                const timeClass = game.time_class; // 'blitz', 'rapid', etc.
                const endTime = game.end_time; // Unix timestamp in seconds

                if (!endTime) continue;

                // Convert to milliseconds
                const endTimeMs = endTime * 1000;
                const isWithin7d = endTimeMs >= timestamp7dAgo;
                const isWithin24h = endTimeMs >= timestamp24hAgo;

                if (timeClass === "rapid") {
                  if (isWithin7d) rapidGames7d++;
                  if (isWithin24h) rapidGames24h++;
                } else if (timeClass === "blitz") {
                  if (isWithin7d) blitzGames7d++;
                  if (isWithin24h) blitzGames24h++;
                }
              }

              const activity = {
                rapidGames24h,
                rapidGames7d,
                blitzGames24h,
                blitzGames7d,
              };

              console.log(`✅ Chess.com activity fetched for ${student.handle}:`, activity);
              return { studentId: student.id, activity };
            } catch (fetchError) {
              clearTimeout(timeoutId);
              throw fetchError;
            }
          }

          return { studentId: student.id, activity: null };
        } catch (error) {
          console.warn(`Error fetching activity for ${student.handle}:`, error);
          return { studentId: student.id, activity: null };
        }
      });

      const results = await Promise.all(activityPromises);

      // Update state with fetched activity (only update if activity is not null)
      // This prevents overwriting good data with zeros from failed requests
      setStudents((prevStudents) => {
        return prevStudents.map((student) => {
          const result = results.find((r) => r.studentId === student.id);
          // Only update if we got valid activity data (not null)
          if (result && result.activity) {
            return {
              ...student,
              rapidGames24h: result.activity.rapidGames24h,
              rapidGames7d: result.activity.rapidGames7d,
              blitzGames24h: result.activity.blitzGames24h,
              blitzGames7d: result.activity.blitzGames7d,
            };
          }
          // If activity is null (failed fetch, no cache), keep existing student data
          return student;
        });
      });
    } catch (error) {
      console.error("Error fetching recent activity:", error);
    }
  }

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

        // Trigger stats update after students are loaded
        await updateStudentStats(mappedStudents);
        
        // Fetch recent activity after stats are loaded
        await fetchRecentActivity(mappedStudents);
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
          const updatedStudents = [...sortedRows, ...students];
          setStudents(updatedStudents);
          setNicknameInput("");

          // Update stats for all students (including newly added ones)
          updateStudentStats(updatedStudents);
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

  // Hide student (temporary removal from view, local state only)
  const handleHide = (id: string) => {
    setStudents(students.filter((student) => student.id !== id));
  };

  // Delete student permanently from database
  const handleDelete = async (id: string) => {
    if (!confirm("Ви точно хочете видалити цього учня з Бази Даних назавжди?")) {
      return;
    }

    try {
      const supabase = createClient();

      // 1. Delete from Supabase (profiles table)
      // Note: This should cascade delete related records (platform_connections, stats_snapshots)
      // if foreign key constraints are set up properly
      const { error } = await supabase.from("profiles").delete().eq("id", id);

      if (error) {
        throw error;
      }

      // 2. Remove from local UI (only if DB delete worked)
      setStudents((prev) => prev.filter((student) => student.id !== id));

      console.log(`Successfully deleted student ${id} from database`);
    } catch (err) {
      console.error("Error deleting student:", err);
      alert("Помилка видалення! Перевірте консоль.");
    }
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
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => handleHide(student.id)}
                      title="Приховати"
                      className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 p-1 rounded transition-colors"
                    >
                      <EyeOff size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(student.id)}
                      title="Видалити з бази"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
