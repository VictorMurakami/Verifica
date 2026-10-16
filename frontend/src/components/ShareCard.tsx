"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Copy, Download, RefreshCw, Share2, X } from "lucide-react";
import { AnalysisResult } from "@/types/analysis";
import { CATEGORY_LABELS } from "@/lib/categories";
import { layoutBadgeRows } from "@/lib/layoutBadgeRows";
import { ScoreBand, scoreBand, SCORE_LABELS } from "@/lib/score";
import { shareText } from "@/lib/share";
import { SITE_URL } from "@/lib/site";

interface Props {
  result: AnalysisResult;
}

const SCORE_COLORS: Record<ScoreBand, string> = {
  suspicious: "#f87171",
  attention: "#fbbf24",
  reliable: "#4ade80",
};

function getScoreConfig(score: number) {
  const band = scoreBand(score);
  return { label: SCORE_LABELS[band], color: SCORE_COLORS[band] };
}

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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Falha ao gerar a imagem do canvas."));
    }, "image/png");
  });
}

async function renderCard(result: AnalysisResult): Promise<Blob> {
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

  // Load image
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao carregar o logotipo."));
      img.src = src;
    });
  };

  const logoImg = await loadImage("/logos/share/Logotipo1_Dark.png");
  const logoH = 28 * S;
  const logoW = (logoImg.width / logoImg.height) * logoH;

  // Pre-measure category badges so wrapped rows get the height they need.
  const categoryLabels = [...new Set(result.flaggedExcerpts.map((e) => e.category))].map(
    (cat) => CATEGORY_LABELS[cat] ?? cat,
  );
  ctx.font = `500 ${15 * S}px ${font}`;
  const badgeWidths = categoryLabels.map((label) => ctx.measureText(label).width + 28 * S);
  const badgeGap = 10 * S;
  const badgeRowH = 34 * S;
  const badgeRowGap = 10 * S;
  const badgeRows = layoutBadgeRows(badgeWidths, contentW, badgeGap);

  // Calculate total height
  let totalH = PAD;
  totalH += Math.max(36 * S, logoH) + 40 * S;    // logo + gap
  totalH += 90 * S;              // score number
  totalH += 30 * S + 40 * S;    // score label + gap
  totalH += verdict.height + 36 * S + 32 * S; // verdict box + padding + gap
  if (badgeRows.length > 0) {
    totalH += badgeRows.length * badgeRowH + (badgeRows.length - 1) * badgeRowGap + 6 * S;
  }
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
  ctx.drawImage(logoImg, PAD, y, logoW, logoH);

  ctx.font = `400 ${18 * S}px ${font}`;
  ctx.fillStyle = "rgba(166,173,186,0.8)";
  const urlText = SITE_URL.host;
  const urlW = ctx.measureText(urlText).width;
  ctx.fillText(urlText, W - PAD - urlW, y + 22 * S);

  y += Math.max(36 * S, logoH) + 40 * S;

  // Score number
  ctx.textAlign = "center";
  const scoreStr = String(result.reliabilityScore);
  ctx.font = `800 ${80 * S}px ${font}`;
  const scoreW = ctx.measureText(scoreStr).width;
  ctx.fillStyle = scoreConfig.color;
  // Draw score and % side by side, both centered as a group
  ctx.font = `400 ${30 * S}px ${font}`;
  const percentW = ctx.measureText("%").width;
  const groupW = scoreW + 8 * S + percentW;
  const groupX = W / 2 - groupW / 2;

  ctx.font = `800 ${80 * S}px ${font}`;
  ctx.textAlign = "left";
  ctx.fillStyle = scoreConfig.color;
  ctx.fillText(scoreStr, groupX, y + 70 * S);

  ctx.font = `400 ${30 * S}px ${font}`;
  ctx.fillStyle = "rgba(166,173,186,0.75)";
  ctx.fillText("%", groupX + scoreW + 8 * S, y + 70 * S);
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

  // Category badges, wrapped across as many rows as layoutBadgeRows produced.
  if (badgeRows.length > 0) {
    ctx.font = `500 ${15 * S}px ${font}`;
    for (const row of badgeRows) {
      let bx = PAD;
      for (const index of row) {
        const label = categoryLabels[index];
        const bw = badgeWidths[index];

        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1.5 * S;
        ctx.beginPath();
        ctx.roundRect(bx, y, bw, badgeRowH, 999);
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(label, bx + 14 * S, y + 22 * S);

        bx += bw + badgeGap;
      }
      y += badgeRowH + badgeRowGap;
    }
  }

  return canvasToBlob(canvas);
}

export default function ShareCard({ result }: Props) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(false);
  const [canShareApi, setCanShareApi] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const titleId = useId();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const generationIdRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const actionInProgressRef = useRef(false);

  useEffect(() => {
    setCanShareApi(typeof navigator !== "undefined" && typeof navigator.share === "function");
    setIsCoarsePointer(typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Open/close the native <dialog> imperatively so the browser handles
  // initial focus, focus trapping, Esc and ::backdrop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Keep React state in sync with Esc/native close, and return focus
  // to the button that opened the modal.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      setOpen(false);
      triggerButtonRef.current?.focus();
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  // Revoke the last preview object URL on unmount.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const generatePreview = useCallback(async () => {
    const id = ++generationIdRef.current;
    setGenerating(true);
    setGenError(false);
    try {
      const blob = await renderCard(result);
      if (generationIdRef.current !== id) return; // stale response, ignore
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
      setPreviewFile(new File([blob], "verifica-analise.png", { type: "image/png" }));
    } catch (e) {
      if (generationIdRef.current !== id) return;
      console.error(e);
      setGenError(true);
    } finally {
      if (generationIdRef.current === id) setGenerating(false);
    }
  }, [result]);

  function openModal() {
    setOpen(true);
    setFeedback(null);
    void generatePreview();
  }

  function closeModal() {
    setOpen(false);
  }

  function handleDialogClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) closeModal(); // click on ::backdrop
  }

  // The File is already in state; share() is invoked synchronously, with
  // no await before it, so the OS share sheet keeps the click's user activation.
  function handleShare() {
    if (actionInProgressRef.current || !previewFile) return;
    actionInProgressRef.current = true;
    setFeedback(null);

    let sharePromise: Promise<void>;
    try {
      if (navigator.canShare?.({ files: [previewFile] })) {
        sharePromise = navigator.share({ files: [previewFile], title: "Verifica", text: shareText(result) });
      } else if (navigator.share) {
        sharePromise = navigator.share({ title: "Verifica", text: shareText(result), url: SITE_URL.href });
      } else {
        actionInProgressRef.current = false;
        return;
      }
    } catch {
      actionInProgressRef.current = false;
      setFeedback("Não deu para compartilhar. Baixe a imagem ou copie o texto.");
      return;
    }

    sharePromise
      .then(() => closeModal())
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setFeedback("Não deu para compartilhar. Baixe a imagem ou copie o texto.");
        }
      })
      .finally(() => {
        actionInProgressRef.current = false;
      });
  }

  function handleDownload() {
    if (actionInProgressRef.current || !previewFile) return;
    actionInProgressRef.current = true;
    setFeedback(null);
    try {
      const url = URL.createObjectURL(previewFile);
      const link = document.createElement("a");
      link.download = "verifica-analise.png";
      link.href = url;
      link.click();
      // Revoking right away can cancel the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      console.error(e);
      setFeedback("Não deu para baixar a imagem. Toque e segure a imagem para salvar.");
    } finally {
      actionInProgressRef.current = false;
    }
  }

  async function handleCopyText() {
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(shareText(result));
      setFeedback("Texto copiado.");
    } catch {
      setFeedback("Não deu para copiar.");
    }
  }

  const scoreLabel = SCORE_LABELS[scoreBand(result.reliabilityScore)];
  const previewAlt = `Imagem para compartilhar: ${result.reliabilityScore}% · ${scoreLabel}. ${result.overallVerdict}`;
  const liveMessage = generating
    ? "Gerando imagem…"
    : genError
      ? "Não foi possível gerar a imagem."
      : feedback;
  const canAct = !generating && !genError && !!previewFile;

  return (
    <>
      <button
        ref={triggerButtonRef}
        onClick={openModal}
        className="btn btn-ghost rounded-full gap-2 hover:bg-base-content/5 active:scale-95 transition-all duration-200"
      >
        <Share2 size={16} />
        Compartilhar
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby={titleId}
        onClick={handleDialogClick}
      >
        <div
          className="modal-box max-w-lg forced-colors:border forced-colors:border-[CanvasText]"
          aria-busy={generating}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn btn-ghost rounded-full absolute right-3 top-3 size-[44px] p-0"
            aria-label="Fechar"
            onClick={closeModal}
          >
            <X size={16} />
          </button>
          <h3 id={titleId} className="font-bold text-lg mb-4 pr-[52px]">
            Compartilhar análise
          </h3>

          {previewUrl && (
            <img src={previewUrl} alt={previewAlt} className="w-full rounded-xl mb-1" />
          )}

          {isCoarsePointer && previewUrl && (
            <p className="text-xs text-base-content/50 text-center mb-3">
              Você também pode tocar e segurar a imagem para salvar.
            </p>
          )}

          {genError ? (
            <button
              className="btn btn-outline btn-error btn-block rounded-full gap-2 min-h-[44px]"
              onClick={() => void generatePreview()}
            >
              <RefreshCw size={16} />
              Tentar de novo
            </button>
          ) : canShareApi ? (
            <button
              className="btn btn-primary btn-block rounded-full gap-2 min-h-[48px]"
              onClick={handleShare}
              disabled={!canAct}
            >
              {generating ? (
                <span className="loading loading-spinner loading-sm motion-reduce:hidden" />
              ) : (
                <Share2 size={16} />
              )}
              {generating ? "Gerando imagem…" : "Compartilhar"}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block rounded-full gap-2 min-h-[48px]"
              onClick={handleDownload}
              disabled={!canAct}
            >
              {generating ? (
                <span className="loading loading-spinner loading-sm motion-reduce:hidden" />
              ) : (
                <Download size={16} />
              )}
              {generating ? "Gerando imagem…" : "Baixar imagem"}
            </button>
          )}

          <div className="flex justify-center gap-4 mt-3">
            {canShareApi && !genError && (
              <button
                className="btn btn-ghost btn-sm gap-1.5 min-h-[44px] px-4"
                onClick={handleDownload}
                disabled={!canAct}
              >
                <Download size={14} />
                Baixar imagem
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm gap-1.5 min-h-[44px] px-4"
              onClick={handleCopyText}
              disabled={generating}
            >
              <Copy size={14} />
              Copiar texto
            </button>
          </div>

          <div aria-live="polite" className="text-xs text-center text-base-content/60 mt-2 min-h-4">
            {liveMessage}
          </div>
        </div>
      </dialog>
    </>
  );
}
