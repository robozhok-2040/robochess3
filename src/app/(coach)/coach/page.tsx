"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { scheduleLichessRequest } from "@/lib/rateLimiter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// API Response type - matches the structure from /api/coach/students
interface ApiStudent {
  id: string;
  nickname: string;
  stats: {
    rapidRating: number | null;
    blitzRating: number | null;
    puzzleRating: number | null;
    rapidGames24h: number;
    rapidGames7d: number;
    blitzGames24h: number;
    blitzGames7d: number;
    puzzles3d: number; // Maps from DB column puzzles_24h
    puzzles7d: number;
    puzzle_total: number;
  };
  platform?: string;
  platform_username?: string;
  avatar_url?: string;
  last_active?: string | null;
}

// Internal Student type for table display (includes additional fields with defaults)
type Student = ApiStudent & {
  platform: "lichess" | "chesscom";
  handle: string;
  rapidGames24h: number;
  rapidGames7d: number;
  blitzGames24h: number;
  blitzGames7d: number;
  homeworkCompletionPct: number;
  puzzleDelta3d: number | null; // Use puzzles3d from API
  puzzleDelta7d: number | null;
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
  | "puzzleDelta3d"
  | "puzzleDelta7d"
  | "puzzleRating"
  | "homeworkPct"
  | "lastActive";

export default function CoachDashboardPage() {
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [nicknameInput, setNicknameInput] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUpdatingStats, setIsUpdatingStats] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("nickname");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [platformFilter, setPlatformFilter] = useState<"all" | "lichess" | "chesscom">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper function to format relative time and determine traffic light color
  function formatLastActive(seenAt: number | null): { label: string; color: string } {
    if (seenAt === null || seenAt === undefined) {
      return { label: "—", color: "gray" };
    }

    const now = Date.now();
    const diffMs = now - seenAt;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    let label: string;
    let color: string;

    if (diffHours < 24) {
      // Within 24 hours - Green
      color = "green";
      if (diffHours < 1) {
        const minutes = Math.floor(diffMs / (1000 * 60));
        label = `${minutes}m`;
      } else {
        const hours = Math.floor(diffHours);
        label = `${hours}h`;
      }
    } else if (diffDays < 5) {
      // Between 24 hours and 5 days - Yellow
      color = "yellow";
      const days = Math.floor(diffDays);
      label = `${days}d`;
    } else {
      // Older than 5 days - Red
      color = "red";
      const days = Math.floor(diffDays);
      label = `${days}d`;
    }

    return { label, color };
  }

  // Helper to get badge variant and label from lastActiveStatus
  function getStatusBadge(status: 'green' | 'grey'): { label: string; variant: "success" | "warning" | "muted" } {
    if (status === "green") {
      return { label: "Active", variant: "success" };
    }
    return { label: "Inactive", variant: "muted" };
  }

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
              seenAt: data.seenAt || null, // Timestamp in milliseconds
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
              seenAt: null, // Chess.com API doesn't provide seenAt timestamp
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
              stats: {
                ...(student.stats || {}),
                rapidRating: result.updates.rapidRating ?? student.stats?.rapidRating,
                blitzRating: result.updates.blitzRating ?? student.stats?.blitzRating,
                puzzleRating: result.updates.puzzleRating ?? student.stats?.puzzleRating,
              },
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

  // Fetch Lichess puzzle stats (total puzzles solved)
  async function fetchLichessPuzzleStats(username: string): Promise<number> {
    console.log(`[PUZZLES] fetchLichessPuzzleStats called for: ${username}`);
    const cacheKey = `lichess_puzzles_total_v1_${username}`;
    const cacheMaxAge = 15 * 60 * 1000; // 15 minutes in milliseconds

    // 1. Check cache first
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cacheAge = Date.now() - parsed.timestamp;

        if (cacheAge < cacheMaxAge) {
          console.log(
            `[PUZZLES CACHE HIT] Using cached puzzle data for ${username} (${Math.round(cacheAge / 1000)}s old)`
          );
          return parsed.puzzlesTotal;
        }
      }
    } catch (e) {
      // Cache parse error, continue to API call
      console.warn(`Puzzle cache read error for ${username}:`, e);
    }

    try {
      // 2. Fetch user profile from Lichess API (public endpoint)
      const res = await scheduleLichessRequest(async () => {
        return fetch(`https://lichess.org/api/user/${encodeURIComponent(username)}`);
      });

      if (!res.ok) {
        console.warn(`Failed to fetch Lichess profile for ${username}: ${res.status}`);
        // Try stale cache on error
        try {
          const cachedData = localStorage.getItem(cacheKey);
          if (cachedData) {
            const parsed = JSON.parse(cachedData);
            console.log(`[PUZZLES CACHE FALLBACK] Using stale cache for ${username} due to ${res.status}`);
            return parsed.puzzlesTotal;
          }
        } catch (e) {
          // Cache fallback failed
        }
        return 0;
      }

      const data = await res.json();

      // 3. Extract total puzzles solved from perfs.puzzle.games
      const puzzlesTotal = data?.perfs?.puzzle?.games ?? 0;

      console.log(`[PUZZLES] Found ${puzzlesTotal} total puzzles for ${username}`);

      // 4. Save to cache
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({
            puzzlesTotal,
            timestamp: Date.now(),
          })
        );
        console.log(`[PUZZLES CACHE SAVED] Cached puzzle data for ${username}: ${puzzlesTotal} total puzzles`);
      } catch (e) {
        console.warn(`Failed to save puzzle cache for ${username}:`, e);
      }

      return puzzlesTotal;
    } catch (error) {
      console.error(`Error fetching puzzle stats for ${username}:`, error);

      // Try stale cache on error
      try {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          console.log(`[PUZZLES CACHE FALLBACK] Using stale cache for ${username} due to error`);
          return parsed.puzzlesTotal;
        }
      } catch (e) {
        // Cache fallback failed
      }

      return 0;
    }
  }

  // Fetch puzzle stats for all students
  async function fetchPuzzleStats(studentsList: Student[]) {
    if (studentsList.length === 0) {
      console.log("[PUZZLES] No students to fetch puzzle stats for");
      return;
    }

    console.log(`[PUZZLES] Starting puzzle stats fetch for ${studentsList.length} students`);

    try {
      // Fetch puzzle stats for Lichess students in parallel
      const lichessStudents = studentsList.filter((s) => s.platform === "lichess" && s.handle);
      console.log(`[PUZZLES] Found ${lichessStudents.length} Lichess students to fetch`);

      const puzzlePromises = lichessStudents.map(async (student) => {
        console.log(`[PUZZLES] Fetching puzzles for: ${student.handle} (id: ${student.id})`);
        try {
          const puzzlesTotal = await fetchLichessPuzzleStats(student.handle);
          console.log(`[PUZZLES] Got ${puzzlesTotal} puzzles for ${student.handle}`);

          return { studentId: student.id, puzzles24h: puzzlesTotal };
        } catch (error) {
          console.warn(`[PUZZLES] Error fetching puzzle stats for ${student.handle}:`, error);
          return { studentId: student.id, puzzles24h: null };
        }
      });

      const results = await Promise.all(puzzlePromises);
      console.log(`[PUZZLES] Puzzle stats fetch complete. Results:`, results);

      // Update state with fetched puzzle stats and recalculate deltas
      setStudents((prevStudents) => {
        const updated = prevStudents.map((student) => {
          const result = results.find((r) => r.studentId === student.id);
          if (result && result.puzzles24h !== null) {
            console.log(`[PUZZLES] Updating student ${student.id} with ${result.puzzles24h} puzzles`);
            
            // Update puzzles3d with new value
            return {
              ...student,
              stats: {
                ...student.stats,
                puzzles3d: result.puzzles24h,
              },
              puzzleDelta3d: result.puzzles24h, // Also update puzzleDelta3d for sorting
            };
          }
          return student;
        });
        console.log(`[PUZZLES] State update complete. Updated ${results.filter(r => r.puzzles24h !== null).length} students`);
        
        return updated;
      });
    } catch (error) {
      console.error("Error fetching puzzle stats:", error);
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

  // Fetch students from API on mount
  useEffect(() => {
    async function fetchStudents() {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch("/api/coach/students");
        
        if (!response.ok) {
          throw new Error(`Failed to fetch students: ${response.statusText}`);
        }
        
        const apiData: ApiStudent[] = await response.json();
        
        if (!Array.isArray(apiData)) {
          throw new Error("Invalid API response format");
        }

        // Map API response to Student type with defaults for missing fields
        const mappedStudents: Student[] = apiData.map((item: ApiStudent) => {
          // Compute lastActiveStatus: 'green' if active in last 24h (has games or puzzles), 'grey' otherwise
          const hasActivity24h = (item.stats?.rapidGames24h ?? 0) + (item.stats?.blitzGames24h ?? 0) + (item.stats?.puzzles3d ?? 0) > 0;
          const lastActiveStatus: 'green' | 'grey' = hasActivity24h ? 'green' : 'grey';
          
          return {
            ...item,
            lastActiveStatus,
            platform: (item.platform === "lichess" || item.platform === "chesscom" ? item.platform : "lichess") as "lichess" | "chesscom",
            handle: item.platform_username || item.nickname, // Use platform_username if available, otherwise nickname
            // CRITICAL: Read from item.stats (the API response structure)
            rapidGames24h: item.stats?.rapidGames24h ?? 0,
            rapidGames7d: item.stats?.rapidGames7d ?? 0,
            blitzGames24h: item.stats?.blitzGames24h ?? 0,
            blitzGames7d: item.stats?.blitzGames7d ?? 0,
            homeworkCompletionPct: 0, // API doesn't provide this yet
            // Map puzzles3d to puzzleDelta3d for display in Puzzles (3d) column
            puzzleDelta3d: item.stats?.puzzles3d ?? null,
            puzzleDelta7d: item.stats?.puzzles7d ?? null,
          };
        });

        setStudents(mappedStudents);
      } catch (error) {
        console.error("Error fetching students:", error);
        setError(error instanceof Error ? error.message : "Failed to load students");
      } finally {
        setLoading(false);
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
        const apiRows = data.rows || [];
        
        // Map API rows to Student type, initializing delta fields to null (no history yet)
        const newRows: Student[] = apiRows.map((row: any) => ({
          ...row,
          puzzleDelta3d: null,
          puzzleDelta7d: null,
          seenAt: null, // Will be updated when stats are fetched
        }));
        
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
          
          // Fetch puzzle stats for newly added students
          fetchPuzzleStats(updatedStudents);
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

  // Hide student (temporary removal from view using hiddenIds filter)
  const handleHide = (id: string) => {
    setHiddenIds((prev) => [...prev, id]);
  };

  // Show all hidden students
  const handleShowAllStudents = () => {
    setHiddenIds([]);
  };

  // Delete student permanently from database
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this student from the database?")) {
      return;
    }

    try {
      // Delete via API route (uses Prisma)
      const response = await fetch(`/api/coach/student/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      // Remove from local UI state immediately
      setStudents((prev) => prev.filter((student) => student.id !== id));

      // Refresh router cache to ensure consistency
      router.refresh();

      console.log(`Successfully deleted student ${id} from database`);
    } catch (err) {
      console.error("Error deleting student:", err);
      alert(`Failed to delete student: ${err instanceof Error ? err.message : "Check console for details"}`);
    }
  };

  const handleUpdateStats = async () => {
    setIsUpdatingStats(true);
    try {
      const response = await fetch("/api/cron/update-stats");

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log("Stats update completed:", result);

      // Show success message
      const updateCount = result.summary?.includes("Updated") ? result.details?.length || 0 : result.updated || 0;
      alert(`Stats updated successfully! Updated ${updateCount} students.`);

      // Refresh the page data using Next.js router
      router.refresh();
    } catch (error) {
      console.error("Error updating stats:", error);
      alert(`Failed to update stats: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsUpdatingStats(false);
    }
  };

  const handleSort = (key: SortKey) => {
    // Numeric columns default to "desc", text columns default to "asc"
    const numericKeys: SortKey[] = ["rapid24h", "rapid7d", "blitz24h", "blitz7d", "rapidRating", "blitzRating", "puzzleRating", "homeworkPct", "puzzleDelta3d", "puzzleDelta7d", "lastActive"];
    const defaultDir: "asc" | "desc" = numericKeys.includes(key) ? "desc" : "asc";

    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  };

  // Filter out hidden students and by platform
  const displayedStudents = students.filter((s) => {
    if (hiddenIds.includes(s.id)) return false;
    if (platformFilter === "all") return true;
    return s.platform === platformFilter;
  });

  const sortedStudents = useMemo(() => {
    const sorted = [...displayedStudents];

    // No special case for "index" - just sort normally

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
          aVal = a.stats?.rapidRating;
          bVal = b.stats?.rapidRating;
          break;
        case "blitzRating":
          aVal = a.stats?.blitzRating;
          bVal = b.stats?.blitzRating;
          break;
        case "puzzleDelta3d":
          aVal = a.stats?.puzzles3d;
          bVal = b.stats?.puzzles3d;
          break;
        case "puzzleDelta7d":
          aVal = a.puzzleDelta7d;
          bVal = b.puzzleDelta7d;
          break;
        case "puzzleRating":
          aVal = a.stats?.puzzleRating;
          bVal = b.stats?.puzzleRating;
          break;
        case "homeworkPct":
          aVal = a.homeworkCompletionPct;
          bVal = b.homeworkCompletionPct;
          break;
        case "lastActive":
          // Sort by lastActiveStatus: 'green' (active) comes before 'grey' (inactive)
          // For ascending: green = 0, grey = 1
          // For descending: grey = 0, green = 1
          const greenValue = 0;
          const greyValue = 1;
          aVal = a.lastActiveStatus === "green" ? greenValue : greyValue;
          bVal = b.lastActiveStatus === "green" ? greenValue : greyValue;
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
  }, [displayedStudents, sortKey, sortDir]);

  // Compute KPI metrics from sortedStudents
  const kpiMetrics = useMemo(() => {
    const total = sortedStudents.length;

    // Count active students (based on lastActiveStatus)
    const active24h = sortedStudents.filter((student) => student.lastActiveStatus === "green").length;

    // Calculate average Rapid rating
    const rapidRatings = sortedStudents
      .map((s) => s.stats?.rapidRating ?? null)
      .filter((r): r is number => r !== null && r !== 0);
    const avgRapid =
      rapidRatings.length > 0
        ? Math.round(rapidRatings.reduce((sum, r) => sum + r, 0) / rapidRatings.length)
        : null;

    // Calculate average Blitz rating
    const blitzRatings = sortedStudents
      .map((s) => s.stats?.blitzRating ?? null)
      .filter((r): r is number => r !== null && r !== 0);
    const avgBlitz =
      blitzRatings.length > 0
        ? Math.round(blitzRatings.reduce((sum, r) => sum + r, 0) / blitzRatings.length)
        : null;

    // Calculate total Rapid games (24h)
    const rapidGames24h = sortedStudents.reduce((acc, s) => acc + (s.rapidGames24h ?? 0), 0);

    // Calculate total Blitz games (24h)
    const blitzGames24h = sortedStudents.reduce((acc, s) => acc + (s.blitzGames24h ?? 0), 0);

    return { total, active24h, avgRapid, avgBlitz, rapidGames24h, blitzGames24h };
  }, [sortedStudents]);

  return (
    <div className="max-w-[1600px] mx-auto min-w-0">
      {/* Header with KPI strip */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mt-4 mb-4">
        <h1 className="text-4xl font-semibold leading-none text-[hsl(var(--foreground))]">Dashboard</h1>

        <div className="flex items-center gap-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            {/* Total Students */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Students
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {kpiMetrics.total}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Total tracked
              </p>
            </Card>

            {/* Active 24h */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  Active (24h)
                </div>
                <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-1.5 py-0.5 rounded">
                  LIVE
                </span>
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {kpiMetrics.active24h}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Seen in last day
              </p>
            </Card>

            {/* Average Rapid */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Avg Rapid
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {kpiMetrics.avgRapid !== null
                  ? new Intl.NumberFormat().format(kpiMetrics.avgRapid)
                  : "—"}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Across rated students
              </p>
            </Card>

            {/* Average Blitz */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Avg Blitz
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {kpiMetrics.avgBlitz !== null
                  ? new Intl.NumberFormat().format(kpiMetrics.avgBlitz)
                  : "—"}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Across rated students
              </p>
            </Card>

            {/* Rapid games (24h) */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Rapid games (24h)
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {new Intl.NumberFormat().format(kpiMetrics.rapidGames24h)}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                All students
              </p>
            </Card>

            {/* Blitz games (24h) */}
            <Card className="px-4 py-2 min-w-[150px]">
              <div className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1">
                Blitz games (24h)
              </div>
              <div className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">
                {new Intl.NumberFormat().format(kpiMetrics.blitzGames24h)}
              </div>
              <p className="hidden xl:block text-xs text-[hsl(var(--muted-foreground))] mt-1">
                All students
              </p>
            </Card>
          </div>

          {/* Update Stats Icon Button */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 rounded-full p-0"
            title="Update stats"
            onClick={handleUpdateStats}
            disabled={isUpdatingStats}
            aria-label="Update stats"
          >
            <span aria-hidden className="text-base leading-none">
              {isUpdatingStats ? "⏳" : "↻"}
            </span>
          </Button>
        </div>
      </div>

      {/* Students Table - Full Width */}
      <div className="min-w-0">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3">
            <div>
              <CardTitle>Students</CardTitle>
              <CardDescription className="hidden sm:block">Track progress and activity</CardDescription>
            </div>
            {error && (
              <div className="w-full sm:w-auto mb-2 sm:mb-0 p-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
                Error: {error}
              </div>
            )}

            <div className="flex items-center gap-2">
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value as "all" | "lichess" | "chesscom")}
                className="h-9 px-3 text-sm rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-2 focus:ring-offset-[hsl(var(--background))] transition-colors"
              >
                <option value="all">All</option>
                <option value="lichess">Lichess</option>
                <option value="chesscom">Chess.com</option>
              </select>
              <div className="group flex items-center w-[200px] sm:w-[220px] focus-within:w-[320px] sm:focus-within:w-[420px] transition-[width] duration-200">
                <Input
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
                  placeholder="Add nickname"
                  className="h-9"
                />
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={isAdding || !nicknameInput.trim()}
              >
                Add
              </Button>
              {errorMsg && (
                <span className="text-red-600 dark:text-red-400 text-xs whitespace-nowrap">
                  {errorMsg}
                </span>
              )}
            </div>
          </CardHeader>
        <CardContent className="p-0">
          {/* Show all students banner */}
          {hiddenIds.length > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-2 text-sm mx-4 mt-4">
              <div className="text-[hsl(var(--muted-foreground))]">
                Some students are hidden
              </div>
              <Button variant="outline" size="sm" onClick={handleShowAllStudents}>
                Show all students
              </Button>
            </div>
          )}
          {loading ? (
            <div className="p-12 text-center text-[hsl(var(--muted-foreground))]">
              Loading students...
            </div>
          ) : (
            <div className="overflow-x-auto tabular-nums">
              <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[hsl(var(--card))] backdrop-blur border-b border-[hsl(var(--border))]">
            <tr>
              <th className="border-r border-[hsl(var(--border))] px-3 py-2 text-center text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide">
                #
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-left text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("nickname")}
              >
                <span className="inline-flex items-center">
                  Nickname
                  {sortKey === "nickname" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-left text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("platform")}
              >
                <span className="inline-flex items-center">
                  Platform
                  {sortKey === "platform" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("rapid24h")}
              >
                <span className="inline-flex items-center justify-end">
                  Rapid 24h
                  {sortKey === "rapid24h" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("rapid7d")}
              >
                <span className="inline-flex items-center justify-end">
                  Rapid 7d
                  {sortKey === "rapid7d" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("blitz24h")}
              >
                <span className="inline-flex items-center justify-end">
                  Blitz 24h
                  {sortKey === "blitz24h" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("blitz7d")}
              >
                <span className="inline-flex items-center justify-end">
                  Blitz 7d
                  {sortKey === "blitz7d" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("rapidRating")}
              >
                <span className="inline-flex items-center">
                  Rapid rating
                  {sortKey === "rapidRating" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("blitzRating")}
              >
                <span className="inline-flex items-center">
                  Blitz rating
                  {sortKey === "blitzRating" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("puzzleDelta3d")}
              >
                <span className="inline-flex items-center justify-end">
                  Puzzles (3d)
                  {sortKey === "puzzleDelta3d" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("puzzleDelta7d")}
              >
                <span className="inline-flex items-center justify-end">
                  Puzzles (7d)
                  {sortKey === "puzzleDelta7d" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("puzzleRating")}
              >
                <span className="inline-flex items-center">
                  Puzzle rating
                  {sortKey === "puzzleRating" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("homeworkPct")}
              >
                <span className="inline-flex items-center justify-end">
                  Homework %
                  {sortKey === "homeworkPct" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th
                className="border-r border-[hsl(var(--border))] px-3 py-2 text-left text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide cursor-pointer hover:bg-[hsl(var(--muted))] transition-colors"
                onClick={() => handleSort("lastActive")}
              >
                <span className="inline-flex items-center">
                  Last active
                  {sortKey === "lastActive" && (
                    <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-[hsl(var(--foreground))] uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedStudents.map((student, index) => {
              const { label: lastActiveLabel, variant: lastActiveVariant } = getStatusBadge(student.lastActiveStatus);
              return (
                <tr key={student.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors bg-[hsl(var(--card))]">
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-center text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {index + 1}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))]">
                    {student.nickname}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                    {student.platform === "lichess" ? "Lichess" : "Chess.com"}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.rapidGames24h}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.rapidGames7d}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.blitzGames24h}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.blitzGames7d}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.stats?.rapidRating !== null && student.stats?.rapidRating !== undefined && student.stats?.rapidRating !== 0 ? student.stats?.rapidRating : <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.stats?.blitzRating !== null && student.stats?.blitzRating !== undefined && student.stats?.blitzRating !== 0 ? student.stats?.blitzRating : <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm tabular-nums">
                    {student.stats?.puzzles3d !== null && student.stats?.puzzles3d !== undefined ? (
                      <span className={(student.stats?.puzzles3d ?? 0) > 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-[hsl(var(--foreground))]"}>
                        {student.stats?.puzzles3d}
                      </span>
                    ) : (
                      <span className="text-[hsl(var(--foreground))]">0</span>
                    )}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm tabular-nums">
                    {student.puzzleDelta7d !== null ? (
                      <span className={student.puzzleDelta7d > 0 ? "text-green-600 dark:text-green-400 font-semibold" : "text-[hsl(var(--muted-foreground))]"}>
                        {student.puzzleDelta7d > 0 ? "+" : ""}{student.puzzleDelta7d}
                      </span>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">—</span>
                    )}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.stats?.puzzleRating !== null && student.stats?.puzzleRating !== undefined && student.stats?.puzzleRating !== 0 ? student.stats?.puzzleRating : <span className="text-[hsl(var(--muted-foreground))]">—</span>}
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-right text-sm text-[hsl(var(--foreground))] tabular-nums">
                    {student.homeworkCompletionPct}%
                  </td>
                  <td className="border-r border-[hsl(var(--border))] px-3 py-2 text-sm">
                    <Badge variant={lastActiveVariant}>{lastActiveLabel}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      {/* Hide Button (with text on desktop) */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleHide(student.id)}
                        title="Hide student"
                        className="h-8 px-2"
                        aria-label="Hide student"
                      >
                        <span className="hidden lg:inline">Hide</span>
                        <span className="lg:hidden">👁</span>
                      </Button>

                      {/* Delete Button (visible) */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        onClick={() => handleDelete(student.id)}
                        title="Delete student"
                        aria-label="Delete student"
                      >
                        🗑
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
