export type Platform = 'lichess' | 'chesscom';
export type Perf = 'rapid' | 'blitz';

export interface DiagnosticInfo {
  url: string;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  lines: number | null;
  sampleLines: string[];
  error?: string;
}

export interface GamesCountResult {
  games24h: number;
  games7d: number;
  diagnostics: DiagnosticInfo;
}


