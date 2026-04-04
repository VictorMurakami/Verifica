"use client";

import { motion } from "framer-motion";
import { ShieldAlert, ShieldQuestion, ShieldCheck } from "lucide-react";

interface Props {
  score: number;
}

function getScoreConfig(score: number) {
  if (score <= 3)
    return { color: "text-error", stroke: "stroke-error", bg: "bg-error/10", badge: "badge-error", label: "Muito Suspeito", Icon: ShieldAlert };
  if (score <= 6)
    return { color: "text-warning", stroke: "stroke-warning", bg: "bg-warning/10", badge: "badge-warning", label: "Atenção Recomendada", Icon: ShieldQuestion };
  return { color: "text-success", stroke: "stroke-success", bg: "bg-success/10", badge: "badge-success", label: "Aparentemente Confiável", Icon: ShieldCheck };
}

export default function ScoreGauge({ score }: Props) {
  const { color, stroke, bg, badge, label, Icon } = getScoreConfig(score);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const target = circumference - (score / 10) * circumference;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`relative inline-flex items-center justify-center rounded-full p-3 ${bg}`}>
        <svg className="w-32 h-32 sm:w-36 sm:h-36 -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} fill="none" className="stroke-base-content/8" strokeWidth="7" />
          <motion.circle
            cx="60" cy="60" r={radius} fill="none"
            className={stroke}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: target }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className={`text-4xl font-bold tabular-nums ${color}`}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.5, ease: "backOut" }}
          >
            {score}
          </motion.span>
          <span className="text-[11px] text-base-content/40 font-medium">de 10</span>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className={`badge ${badge} badge-lg gap-1.5 border-0 font-semibold`}
      >
        <Icon size={14} />
        {label}
      </motion.div>
    </div>
  );
}
