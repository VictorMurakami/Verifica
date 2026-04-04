"use client";

import { useState, useCallback } from "react";
import { Download, Share2, X } from "lucide-react";
import { AnalysisResult, ExcerptCategory } from "@/types/analysis";

interface Props {
  result: AnalysisResult;
}

function getScoreConfig(score: number) {
  if (score <= 3) return { label: "Muito Suspeito", color: "#f87171" };
  if (score <= 6) return { label: "Atenção Recomendada", color: "#fbbf24" };
  return { label: "Aparentemente Confiável", color: "#4ade80" };
}

const categoryLabels: Record<ExcerptCategory, string> = {
  linguagem_alarmista: "Linguagem Alarmista",
  sem_fonte: "Sem Fonte",
  dado_sem_referencia: "Dado sem Referência",
  generalizacao: "Generalização",
  apelo_emocional: "Apelo Emocional",
};

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return { lines, height: lines.length * lineHeight };
}

function renderCard(result: AnalysisResult): string {
  const S = 2; // scale factor for crisp output
  const W = 800 * S;
  const PAD = 56 * S;
  const contentW = W - PAD * 2;
  const scoreConfig = getScoreConfig(result.reliabilityScore);
  const font = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 3000;
  const ctx = canvas.getContext("2d")!;

  // Pre-measure verdict
  ctx.font = `400 ${20 * S}px ${font}`;
  const verdict = wrapText(ctx, result.overallVerdict, contentW - 40 * S, 30 * S);

  // Calculate total height
  let totalH = PAD;
  totalH += 36 * S + 40 * S;    // logo + gap
  totalH += 90 * S;              // score number
  totalH += 30 * S + 40 * S;    // score label + gap
  totalH += verdict.height + 36 * S + 32 * S; // verdict box + padding + gap
  const cats = [...new Set(result.flaggedExcerpts.map((e) => e.category))];
  if (cats.length > 0) totalH += 40 * S;
  totalH += PAD;

  canvas.height = totalH;

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, totalH);
  grad.addColorStop(0, "#1d232a");
  grad.addColorStop(1, "#15191e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, totalH);

  let y = PAD;

  // Logo
  ctx.font = `800 ${32 * S}px ${font}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("VeriFato", PAD, y + 28 * S);
  ctx.font = `400 ${16 * S}px ${font}`;
  ctx.fillStyle = "rgba(166,173,186,0.4)";
  const urlText = "verifato.com.br";
  const urlW = ctx.measureText(urlText).width;
  ctx.fillText(urlText, W - PAD - urlW, y + 28 * S);
  y += 36 * S + 40 * S;

  // Score number
  ctx.textAlign = "center";
  const scoreStr = String(result.reliabilityScore);
  ctx.font = `800 ${80 * S}px ${font}`;
  const scoreW = ctx.measureText(scoreStr).width;
  ctx.fillStyle = scoreConfig.color;
  // Draw score and /10 side by side, both centered as a group
  ctx.font = `400 ${30 * S}px ${font}`;
  const slashW = ctx.measureText("/10").width;
  const groupW = scoreW + 8 * S + slashW;
  const groupX = W / 2 - groupW / 2;

  ctx.font = `800 ${80 * S}px ${font}`;
  ctx.textAlign = "left";
  ctx.fillStyle = scoreConfig.color;
  ctx.fillText(scoreStr, groupX, y + 70 * S);

  ctx.font = `400 ${30 * S}px ${font}`;
  ctx.fillStyle = "rgba(166,173,186,0.45)";
  ctx.fillText("/10", groupX + scoreW + 8 * S, y + 70 * S);
  y += 90 * S;

  // Score label
  ctx.font = `600 ${18 * S}px ${font}`;
  ctx.fillStyle = scoreConfig.color;
  ctx.textAlign = "center";
  ctx.fillText(scoreConfig.label, W / 2, y + 20 * S);
  ctx.textAlign = "left";
  y += 30 * S + 40 * S;

  // Verdict box
  const boxPadY = 18 * S;
  const boxPadX = 20 * S;
  const boxH = verdict.height + boxPadY * 2;
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.beginPath();
  ctx.roundRect(PAD, y, contentW, boxH, 12 * S);
  ctx.fill();

  ctx.font = `400 ${20 * S}px ${font}`;
  ctx.fillStyle = "#a6adba";
  verdict.lines.forEach((line, i) => {
    ctx.fillText(line, PAD + boxPadX, y + boxPadY + 18 * S + i * 30 * S);
  });
  y += boxH + 32 * S;

  // Category badges
  if (cats.length > 0) {
    let bx = PAD;
    ctx.font = `500 ${15 * S}px ${font}`;
    for (const cat of cats) {
      const label = categoryLabels[cat] ?? cat;
      const tw = ctx.measureText(label).width;
      const bw = tw + 28 * S;
      const bh = 34 * S;

      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.roundRect(bx, y, bw, bh, 999);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(label, bx + 14 * S, y + 22 * S);

      bx += bw + 10 * S;
      if (bx + 120 * S > W - PAD) {
        bx = PAD;
        y += bh + 10 * S;
      }
    }
  }

  return canvas.toDataURL("image/png");
}

export default function ShareCard({ result }: Props) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const openModal = useCallback(() => {
    const url = renderCard(result);
    setPreviewUrl(url);
    setOpen(true);
  }, [result]);

  async function handleDownload() {
    setGenerating(true);
    try {
      const dataUrl = previewUrl || renderCard(result);

      if (navigator.share && navigator.canShare) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], "verifato-analise.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "VeriFato - Análise",
            text: `Pontuação: ${result.reliabilityScore}/10`,
            files: [file],
          });
          setOpen(false);
          return;
        }
      }

      const link = document.createElement("a");
      link.download = "verifato-analise.png";
      link.href = dataUrl;
      link.click();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="btn btn-ghost rounded-full gap-2 hover:bg-base-content/5 active:scale-95 transition-all duration-200"
      >
        <Share2 size={16} />
        Compartilhar
      </button>

      {open && (
        <dialog className="modal modal-open" onClick={() => setOpen(false)}>
          <div className="modal-box max-w-lg" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
            <h3 className="font-bold text-lg mb-4">Compartilhar Análise</h3>

            {previewUrl && (
              <img
                src={previewUrl}
                alt="Preview da análise"
                className="w-full rounded-xl"
              />
            )}

            <div className="modal-action">
              <button
                className="btn btn-primary rounded-full gap-2"
                onClick={handleDownload}
                disabled={generating}
              >
                {generating ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <Download size={16} />
                )}
                {generating ? "Gerando..." : "Baixar Imagem"}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setOpen(false)}>close</button>
          </form>
        </dialog>
      )}
    </>
  );
}
