import { AnalysisRequest, AnalysisResult } from "@/types/analysis";
import { GENERIC_ERROR, NETWORK_ERROR, STATUS_MESSAGES } from "./errorMessages";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function errorMessageFrom(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string" && body.detail) return body.detail;
  } catch {
    // Corpo não-JSON: cai na mensagem por status.
  }
  return STATUS_MESSAGES[response.status] ?? GENERIC_ERROR;
}

function isAnalysisResult(body: unknown): body is AnalysisResult {
  if (!body || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  return (
    Number.isFinite(candidate.reliabilityScore) &&
    typeof candidate.overallVerdict === "string" &&
    Array.isArray(candidate.flaggedExcerpts) &&
    typeof candidate.analyzedText === "string" &&
    typeof candidate.requestId === "string"
  );
}

export async function analyzeContent(request: AnalysisRequest, turnstileToken: string): Promise<AnalysisResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: request.id, content: request.content, turnstileToken }),
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (!response.ok) {
    throw new Error(await errorMessageFrom(response));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(GENERIC_ERROR);
  }
  if (!isAnalysisResult(body)) {
    throw new Error(GENERIC_ERROR);
  }
  return body;
}
