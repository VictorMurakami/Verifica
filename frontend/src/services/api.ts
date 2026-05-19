import { AnalysisRequest, AnalysisResult } from "@/types/analysis";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function analyzeContent(
  request: AnalysisRequest
): Promise<AnalysisResult> {
  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let errorMessage = `Erro ${response.status}: ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        errorMessage = body.detail;
      } else if (body?.error) {
        errorMessage = body.error;
      }
    } catch {
      // If response body is not JSON, use default statusText
    }
    throw new Error(errorMessage);
  }

  return response.json();
}
