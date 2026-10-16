import type { Metadata } from "next";
import NextLink from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o Verifica trata o texto ou link que você envia para análise.",
  alternates: { canonical: "/privacy" },
};

const SECTION = "space-y-2";
const HEADING = "text-xl leading-7 font-semibold";
const BODY = "text-base leading-relaxed text-base-content/80";

export default function PrivacyPage() {
  return (
    <main className="flex-1 w-full max-w-[34rem] mx-auto px-4 py-8 sm:py-12 space-y-8">
      <header className="space-y-1">
        <h1 className="text-[1.75rem] leading-9 font-bold">Política de Privacidade</h1>
        <p className="text-xs text-base-content/70">Atualizada em 16 de outubro de 2026.</p>
      </header>

      <p className={BODY}>
        O Verifica é um projeto sem fins lucrativos. Esta página explica o que acontece com o que você envia para
        análise.
      </p>

      <section className={SECTION}>
        <h2 className={HEADING}>O que guardamos</h2>
        <ul className={`${BODY} list-disc pl-5 space-y-3`}>
          <li>
            <strong className="font-semibold">O texto ou link enviado</strong> e o resultado da análise ficam guardados por até 24 horas, para
            responder mais rápido se a mesma notícia for enviada de novo. Depois disso, são apagados.
          </li>
          <li>
            <strong className="font-semibold">Um código derivado do seu endereço IP</strong>, usado só para limitar quantas análises cada pessoa
            faz por dia. O IP em si não é guardado, e o código é apagado no dia seguinte.
          </li>
          <li>Preferências de tema ficam só no seu navegador.</li>
        </ul>
      </section>

      <section className={SECTION}>
        <h2 className={HEADING}>Com quem compartilhamos</h2>
        <ul className={`${BODY} list-disc pl-5 space-y-3`}>
          <li>
            <strong className="font-semibold">OpenRouter e o provedor do modelo de IA:</strong> o texto enviado, ou o conteúdo da página do link,
            passa por um modelo de IA acessado através do OpenRouter. O provedor do modelo pode registrar o
            conteúdo. Por isso, <strong className="font-semibold">não cole dados pessoais</strong>, seus ou de outras pessoas.
          </li>
          <li>
            <strong className="font-semibold">Cloudflare:</strong> hospeda o site, conta as visitas sem usar cookies (Cloudflare Web
            Analytics) e usa o Turnstile para diferenciar pessoas de robôs sem pedir que você resolva desafios. O Turnstile segue a{" "}
            <a className="link" href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">
              Política de Privacidade da Cloudflare
              <span className="sr-only"> (abre em nova aba)</span>
            </a>{" "}
            e o{" "}
            <a
              className="link"
              href="https://www.cloudflare.com/turnstile-privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Turnstile Privacy Addendum
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
            .
          </li>
        </ul>
      </section>

      <section className={SECTION}>
        <h2 className={HEADING}>O que não fazemos</h2>
        <ul className={`${BODY} list-disc pl-5 space-y-3`}>
          <li>Não pedimos cadastro nem login.</li>
          <li>Não usamos cookies de rastreamento nem ferramentas de anúncio.</li>
          <li>Não vendemos nem cedemos dados.</li>
        </ul>
      </section>

      <section className={SECTION}>
        <h2 className={HEADING}>Contato</h2>
        <p className={BODY}>
          Dúvidas ou pedidos sobre seus dados: abra uma issue no{" "}
          <a
            className="link"
            href="https://github.com/VictorMurakami/Verifica/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub do projeto
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          .
        </p>
      </section>

      <NextLink
        href="/"
        className="btn btn-ghost btn-sm rounded-full mt-12 -ml-3 min-h-11 text-sm font-medium"
      >
        <ArrowLeft size={16} />
        Voltar ao Verifica
      </NextLink>
    </main>
  );
}
