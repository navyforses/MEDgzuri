import { SearchRequest, SearchResponse } from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://medgzuri-production.up.railway.app";

export async function search(request: SearchRequest): Promise<SearchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${API_BASE}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(errorBody || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ძიებას ძალიან დიდი დრო დასჭირდა. გთხოვთ სცადოთ თავიდან.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function healthCheck(): Promise<{ status: string; demo_mode: boolean; has_anthropic: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}
