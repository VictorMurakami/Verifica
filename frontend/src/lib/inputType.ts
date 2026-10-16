import { InputType } from "@/types/analysis";

export function detectInputType(value: string): InputType {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? "url" : "text";
  } catch {
    return "text";
  }
}
