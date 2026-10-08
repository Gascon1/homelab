/** Runs `task` every `ms`, never overlapping itself and never throwing. Does not run immediately. */
export function every(ms: number, task: () => Promise<void> | void): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (err) {
      console.error('[rack] background task failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, ms);
  return () => clearInterval(timer);
}
