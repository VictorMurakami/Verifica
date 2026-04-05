"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, Zap, Lock, Sliders } from "lucide-react";
import { useDebug } from "@/context/DebugContext";
import ThemeLogo from "@/components/ThemeLogo";
import AnalysisForm from "@/components/AnalysisForm";
import AnalysisResultView from "@/components/AnalysisResultView";
import { AnalysisRequest, AnalysisResult } from "@/types/analysis";
import { analyzeContent } from "@/services/api";
import { getMockResult } from "@/services/mock";

export default function Home() {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { debugMode, setDebugMode } = useDebug();
  const [mockScore, setMockScore] = useState(3);
  const [mockDelay, setMockDelay] = useState(1500);

  async function handleSubmit(request: AnalysisRequest) {
    setIsLoading(true);
    setError(null);
    try {
      if (debugMode) {
        const data = await getMockResult(mockDelay);
        data.reliabilityScore = mockScore;
        setResult(data);
      } else {
        const data = await analyzeContent(request);
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao analisar.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleNewAnalysis() {
    setResult(null);
    setError(null);
  }

  useEffect(() => {
    window.addEventListener("verifica:new-analysis", handleNewAnalysis);
    return () => window.removeEventListener("verifica:new-analysis", handleNewAnalysis);
  }, []);

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12">
      {/* Debug panel */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        <AnimatePresence>
          {debugMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="card bg-base-300 shadow-xl border border-warning/30 w-60"
            >
              <div className="card-body p-4 gap-3">
                <span className="badge badge-warning badge-xs">Debug</span>
                <label className="form-control">
                  <span className="label-text text-xs">Score: {mockScore}</span>
                  <input type="range" min={1} max={10} value={mockScore} onChange={(e) => setMockScore(Number(e.target.value))} className="range range-xs range-warning" />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Delay: {mockDelay}ms</span>
                  <input type="range" min={0} max={5000} step={250} value={mockDelay} onChange={(e) => setMockDelay(Number(e.target.value))} className="range range-xs range-warning" />
                </label>
                {result && (
                  <button className="btn btn-xs btn-outline btn-warning" onClick={() => setResult({ ...result, reliabilityScore: mockScore })}>
                    Atualizar score
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {debugMode && (
          <button
            onClick={() => setDebugMode(false)}
            className="btn btn-sm btn-circle shadow-lg btn-warning transition-colors duration-200"
            title="Fechar Debug"
          >
            <Sliders size={16} />
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl text-center space-y-6 sm:space-y-8"
          >
            <div className="space-y-2">
              <div className="flex justify-center mx-auto mb-2">
                <ThemeLogo type="logotipo" width={300} />
              </div>
              <p className="text-base-content/50 text-base sm:text-lg font-light">
                Detector Inteligente de Fake News
              </p>
              {debugMode && <span className="badge badge-warning badge-xs">Mock ativo</span>}
            </div>

            <AnalysisForm onSubmit={handleSubmit} isLoading={isLoading} />

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  role="alert"
                  className="alert alert-error shadow-sm text-sm"
                >
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-base-content/30 text-xs sm:text-sm pt-2"
            >
              {[
                { Icon: Shield, text: "Gratuito" },
                { Icon: Zap, text: "Análise por IA" },
                { Icon: Lock, text: "Sem dados salvos" },
              ].map(({ Icon, text }) => (
                <span key={text} className="flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={1.5} />
                  {text}
                </span>
              ))}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="w-full"
          >
            <AnalysisResultView result={result} onNewAnalysis={handleNewAnalysis} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
