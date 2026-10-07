// Keep restore tokens in this browser, rather than sending them through the PG.
export function checkoutReturnPath(saved: string | null, readingId: string | null) {
  if (!readingId || !/^[a-zA-Z0-9_-]{8,80}$/.test(readingId)) return "/";
  const fallback = `/reading/${encodeURIComponent(readingId)}`;
  if (!saved?.startsWith("/")) return fallback;
  try {
    const url = new URL(saved, "https://checkout.invalid");
    if (url.origin !== "https://checkout.invalid" || url.pathname !== fallback) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
