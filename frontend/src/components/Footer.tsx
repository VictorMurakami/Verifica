"use client";

import { useState } from "react";
import { Heart, Coffee, X, ExternalLink, Code2 } from "lucide-react";

export default function Footer() {
  const [showTip, setShowTip] = useState(false);

  return (
    <>
      <footer className="py-6 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-base-content/40">
          <span>Projeto sem fins lucrativos de utilidade pública</span>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/VictorMurakami/VeriFato"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-xs gap-1.5 rounded-full hover:text-base-content/70"
            >
              <Code2 size={14} />
              GitHub
            </a>
            <button
              onClick={() => setShowTip(true)}
              className="btn btn-ghost btn-xs gap-1.5 rounded-full hover:text-base-content/70"
            >
              <Heart size={14} />
              Apoiar
            </button>
          </div>
        </div>
      </footer>

      {/* Tip modal */}
      {showTip && (
        <dialog className="modal modal-open" onClick={() => setShowTip(false)}>
          <div className="modal-box max-w-sm" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
              onClick={() => setShowTip(false)}
            >
              <X size={16} />
            </button>
            <div className="flex flex-col items-center text-center gap-4 py-2">
              <div className="bg-primary/10 rounded-full p-3">
                <Coffee size={28} className="text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Apoie o VeriFato</h3>
                <p className="text-sm text-base-content/60 mt-1">
                  Este projeto é gratuito e de código aberto. Se ele te ajudou, considere apoiar para
                  manter o serviço no ar.
                </p>
              </div>
              <div className="w-full space-y-2">
                <a
                  href="https://buymeacoffee.com/victorsmur9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary btn-block rounded-full gap-2"
                >
                  <Coffee size={16} />
                  Buy me a coffee
                  <ExternalLink size={12} className="opacity-50" />
                </a>
                <div className="divider text-xs text-base-content/30 my-1">ou via PIX</div>
                <div className="bg-base-200 rounded-xl p-3 text-sm font-mono text-center select-all cursor-pointer hover:bg-base-300 transition-colors">
                  49c438ac-1f04-43cd-83f5-62c717b81bf5
                </div>
                <p className="text-[10px] text-base-content/30 pt-1">
                  Clique na chave para copiar
                </p>
              </div>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowTip(false)}>close</button>
          </form>
        </dialog>
      )}
    </>
  );
}
