"use client";

import { motion } from "framer-motion";
import { RotateCcw, AlertTriangle, BookX, BarChart3, Maximize, Heart } from "lucide-react";
import { AnalysisResult, ExcerptCategory } from "@/types/analysis";
import ScoreGauge from "./ScoreGauge";
import ShareCard from "./ShareCard";

interface Props {
  result: AnalysisResult;
  onNewAnalysis: () => void;
}

const categoryConfig: Record<ExcerptCategory, { label: string; Icon: typeof AlertTriangle }> = {
  linguagem_alarmista: { label: "Linguagem Alarmista", Icon: AlertTriangle },
  sem_fonte: { label: "Sem Fonte", Icon: BookX },
  dado_sem_referencia: { label: "Dado sem Referência", Icon: BarChart3 },
  generalizacao: { label: "Generalização", Icon: Maximize },
  apelo_emocional: { label: "Apelo Emocional", Icon: Heart },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.3 + i * 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

export default function AnalysisResultView({ result, onNewAnalysis }: Props) {
  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 sm:space-y-8 px-1">
      <motion.div
        className="flex justify-center"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="p-4">
          <ScoreGauge score={result.reliabilityScore} />
        </div>
      </motion.div>

      {/* Verdict */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="card bg-base-200 shadow-sm"
      >
        <div className="card-body p-4 sm:p-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-1">
            Veredicto Geral
          </h2>
          <p className="text-sm sm:text-base leading-relaxed">{result.overallVerdict}</p>
        </div>
      </motion.div>

      {/* Flagged excerpts */}
      {result.flaggedExcerpts.length > 0 && (
        <div className="space-y-3 sm:space-y-4">
          <motion.h2
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-xs font-semibold uppercase tracking-wider text-base-content/50"
          >
            Trechos Sinalizados ({result.flaggedExcerpts.length})
          </motion.h2>

          {result.flaggedExcerpts.map((excerpt, i) => {
            const config = categoryConfig[excerpt.category] ?? {
              label: excerpt.category,
              Icon: AlertTriangle,
            };
            const { Icon } = config;

            return (
              <motion.div
                key={i}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="collapse collapse-arrow bg-base-200 shadow-sm"
              >
                <input type="checkbox" defaultChecked={i === 0} />
                <div className="collapse-title flex items-center gap-3 pr-10 min-h-0 py-3 sm:py-4">
                  <div className="badge badge-outline badge-sm gap-1.5 shrink-0">
                    <Icon size={12} />
                    {config.label}
                  </div>
                  <span className="text-sm text-base-content/60 truncate hidden sm:inline">
                    {excerpt.excerpt.slice(0, 60)}...
                  </span>
                </div>
                <div className="collapse-content space-y-3 text-sm">
                  <blockquote className="border-l-3 border-warning/50 pl-3 italic text-base-content/70 leading-relaxed">
                    &ldquo;{excerpt.excerpt}&rdquo;
                  </blockquote>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-base-content/80">Por qu&ecirc;:</span>{" "}
                      <span className="text-base-content/60">{excerpt.reason}</span>
                    </p>
                    <div className="alert alert-info alert-sm py-2 text-xs">
                      <span className="text-info-content/80">{excerpt.suggestion}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="flex flex-wrap justify-center gap-2 pt-2"
      >
        <ShareCard result={result} />
        <button
          className="btn btn-ghost rounded-full gap-2 hover:bg-base-content/5 active:scale-95 transition-all duration-200"
          onClick={onNewAnalysis}
        >
          <RotateCcw size={16} />
          Nova Análise
        </button>
      </motion.div>
    </div>
  );
}
