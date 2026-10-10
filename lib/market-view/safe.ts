/** Runs a loader and returns null on failure, so one section failing does not break a page. */
export async function safe<T>(load: () => Promise<T>): Promise<{ data: T; failed: false } | { data: null; failed: true }> {
  try {
    return { data: await load(), failed: false };
  } catch (error) {
    console.error("[page-data]", error);
    return { data: null, failed: true };
  }
}
