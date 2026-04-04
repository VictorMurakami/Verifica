"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Link, FileText, Loader2 } from "lucide-react";
import { AnalysisRequest, InputType } from "@/types/analysis";

interface Props {
  onSubmit: (request: AnalysisRequest) => void;
  isLoading: boolean;
}

function detectInputType(value: string): InputType {
  try {
    new URL(value);
    return "url";
  } catch {
    return "text";
  }
}

export default function AnalysisForm({ onSubmit, isLoading }: Props) {
  const [content, setContent] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const inputType = content.trim() ? detectInputType(content.trim()) : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    onSubmit({
      id: crypto.randomUUID(),
      inputType: inputType!,
      content: content.trim(),
      timestamp: new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div className="relative">
        <div
          className={`rounded-2xl transition-shadow duration-300 ${
            isFocused
              ? "shadow-lg shadow-primary/10 ring-2 ring-primary/20"
              : "shadow-sm"
          }`}
        >
          <textarea
            className="textarea bg-base-200 border-base-content/8 w-full h-36 sm:h-44 text-base leading-relaxed rounded-2xl resize-none focus:outline-none focus:border-primary/30 placeholder:text-base-content/30"
            placeholder="Cole aqui o texto ou o link da notícia que deseja verificar..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={isLoading}
          />
        </div>

        <AnimatePresence>
          {inputType && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute top-3 right-3"
            >
              <span className="badge badge-sm badge-ghost gap-1.5">
                {inputType === "url" ? <Link size={12} /> : <FileText size={12} />}
                {inputType === "url" ? "URL" : "Texto"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex justify-center">
        <button
          type="submit"
          disabled={!content.trim() || isLoading}
          className="btn btn-primary btn-lg rounded-full px-8 sm:px-10 gap-2 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.97] transition-all duration-200 disabled:opacity-40 disabled:shadow-none"
        >
          {isLoading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>Analisando...</span>
            </>
          ) : (
            <>
              <Search size={18} />
              <span>Verificar</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
