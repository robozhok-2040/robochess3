import Bottleneck from "bottleneck";

// Rate limiter for Lichess API calls
// minTime: 1200ms = ~1 request per 1.2 seconds
// maxConcurrent: 1 = serialized requests (no parallel requests)
export const lichessLimiter = new Bottleneck({
  minTime: 1200, // ~1 request per 1.2 seconds
  maxConcurrent: 1, // Serialize all requests
});

// Helper function to schedule a function through the limiter
export async function scheduleLichessRequest<T>(
  fn: () => Promise<T>
): Promise<T> {
  return lichessLimiter.schedule(fn);
}





