**VERIFATO**

Detector Inteligente de Fake News

Documentação Técnica do Projeto

Versão 1.0 --- Abril 2026

*Projeto sem fins lucrativos de utilidade pública*

1. Descrição da Solução Tecnológica
===================================

1.1 Como a solução funciona
---------------------------

O VeriFato é uma aplicação web de código aberto e sem fins lucrativos, projetada para ajudar qualquer pessoa a identificar indícios de fake news em textos ou matérias jornalísticas. O funcionamento é direto e simples:

1.  **Entrada:** O usuário acessa o site e encontra uma interface limpa com um único campo central. Nele, cola um trecho de texto (snippet) ou o link (URL) de uma reportagem que deseja verificar.

2.  **Processamento:** Ao enviar, o backend recebe o conteúdo. Caso seja uma URL, o sistema primeiro extrai o texto da página (web scraping). Em seguida, o texto é enviado para um modelo de Inteligência Artificial que analisa padrões linguísticos, verificando sinais típicos de desinformação.

3.  **Saída:** O resultado é apresentado de forma visual e acessível, contendo: uma pontuação de confiabilidade de 1 a 10, os trechos específicos que merecem atenção, e uma explicação em linguagem simples dos indícios encontrados.

1.2 Principais recursos e funcionalidades
-----------------------------------------

-   **Análise de texto livre:** O usuário pode colar diretamente um trecho de texto copiado de redes sociais, WhatsApp, e-mail ou qualquer outra fonte.

-   **Análise por URL:** Ao informar o link de uma matéria, o sistema extrai automaticamente o conteúdo textual da página e realiza a análise.

-   **Pontuação de confiabilidade (1--10):** Um indicador visual claro que classifica o nível de confiabilidade do conteúdo, onde 1 significa "muito suspeito" e 10 significa "apparentemente confiável".

-   **Destaque de trechos críticos:** A IA aponta quais partes específicas do texto apresentam sinais de desinformação, para que o usuário saiba exatamente onde pesquisar mais.

-   **Explicação dos indícios:** Para cada sinal detectado, a ferramenta explica em linguagem acessível o motivo pelo qual aquele trecho é suspeito (ex.: linguagem emocional excessiva, falta de fontes, dados sem referência, generalizações absolutas).

1.3 Tecnologias utilizadas
--------------------------

  -------------------- ------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Camada**           **Tecnologia**                              **Justificativa**
  **Frontend**         Next.js 14 (React), Tailwind CSS            Framework moderno com SSR, otimização de performance e boa experiência de desenvolvimento. Tailwind permite prototipagem rápida de interfaces responsivas.
  **Backend**          Next.js API Routes (Node.js)                As API Routes do Next.js permitem criar endpoints dentro do próprio projeto, eliminando a necessidade de um servidor separado e simplificando o deploy.
  **Banco de Dados**   Sem banco de dados permanente               Como não há login, contas ou histórico, não é necessário persistir dados. Opcionalmente, pode-se usar Redis para cache temporário de análises recentes.
  **IA / LLM**         API da Anthropic (Claude) ou OpenAI (GPT)   Modelos de linguagem de grande porte (LLMs) são ideais para análise linguística, identificação de padrões retóricos e classificação de conteúdo.
  **Web Scraping**     Cheerio + Axios                             Bibliotecas leves em Node.js para extrair conteúdo textual de URLs informadas pelo usuário.
  **Hospedagem**       Vercel                                      Plataforma com plano gratuito ideal para projetos Next.js, com deploy automático via GitHub e CDN global.
  -------------------- ------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------

1.4 Onde a IA é aplicada e qual sua função
------------------------------------------

A Inteligência Artificial é o núcleo da análise do VeriFact. Ela é aplicada em um único ponto do fluxo: após o texto ser recebido (digitado ou extraído de uma URL), ele é enviado como prompt estruturado para um modelo LLM via API.

A função da IA é tripla:

-   **Classificar:** Atribuir uma nota de confiabilidade ao texto (escala 1--10), baseada na presença ou ausência de indícios de manipulação.

-   **Localizar:** Apontar os trechos específicos que levantam suspeita, permitindo ao usuário verificar por conta própria.

-   **Explicar:** Descrever em linguagem acessível os padrões identificados, como: uso excessivo de linguagem alarmista, ausência de fontes verificáveis, dados sem referência, generalizações absolutas e apelo emocional.

A IA não é usada para gerar conteúdo, apenas para analisar. Isso garante que a ferramenta permanece focada em seu propósito de verificação.

2. Modelagem das Principais Entidades do Sistema
================================================

Como o VeriFact é uma aplicação stateless (sem estado persistente), ou seja, sem login, sem contas e sem histórico armazenado, suas entidades representam os objetos que transitam pelo sistema durante uma sessão de análise. Abaixo estão as principais entidades e seus atributos.

2.1 Entidade: Requisição de Análise (AnalysisRequest)
-----------------------------------------------------

Representa o dado enviado pelo usuário ao clicar em "Verificar".

  --------------- ---------- --------------------------------------------------------
  **Atributo**    **Tipo**   **Descrição**
  **id**          UUID       Identificador único da requisição (gerado no frontend)
  **inputType**   Enum       Tipo da entrada: \'text\' ou \'url\'
  **content**     String     Conteúdo textual ou URL fornecido pelo usuário
  **timestamp**   DateTime   Data e hora do envio da análise
  --------------- ---------- --------------------------------------------------------

2.2 Entidade: Resultado da Análise (AnalysisResult)
---------------------------------------------------

Representa o retorno completo da IA após processar o texto.

  ---------------------- ------------------ -----------------------------------------------
  **Atributo**           **Tipo**           **Descrição**
  **requestId**          UUID               Referência à requisição original
  **reliabilityScore**   Integer (1--10)    Nota de confiabilidade do conteúdo analisado
  **overallVerdict**     String             Resumo geral da análise em linguagem simples
  **flaggedExcerpts**    Array\<Excerpt\>   Lista dos trechos suspeitos identificados
  **analyzedText**       String             Texto completo que foi efetivamente analisado
  ---------------------- ------------------ -----------------------------------------------

2.3 Entidade: Trecho Sinalizado (FlaggedExcerpt)
------------------------------------------------

Representa cada ponto específico do texto que a IA identificou como suspeito.

  ---------------- ---------- -------------------------------------------------------------------------------------------------------------------------------------
  **Atributo**     **Tipo**   **Descrição**
  **excerpt**      String     Trecho exato do texto sinalizado
  **reason**       String     Explicação do motivo da sinalização
  **category**     Enum       Tipo do indício (ex.: \'linguagem\_alarmista\', \'sem\_fonte\', \'dado\_sem\_referencia\', \'generalizacao\', \'apelo\_emocional\')
  **suggestion**   String     Sugestão do que o usuário pode fazer para verificar aquele trecho
  ---------------- ---------- -------------------------------------------------------------------------------------------------------------------------------------

2.4 Entidade: Conteúdo Extraído (ScrapedContent)
------------------------------------------------

Entidade auxiliar, usada apenas quando o usuário fornece uma URL em vez de texto.

  --------------- ---------- -------------------------------------------
  **Atributo**    **Tipo**   **Descrição**
  **url**         String     URL original fornecida pelo usuário
  **title**       String     Título da página extraída
  **bodyText**    String     Conteúdo textual limpo extraído da página
  **source**      String     Domínio de origem (ex.: g1.globo.com)
  **scrapedAt**   DateTime   Data e hora da extração do conteúdo
  --------------- ---------- -------------------------------------------

3. Arquitetura da Aplicação
===========================

3.1 Visão geral da arquitetura
------------------------------

O VeriFact adota uma arquitetura monolítica simplificada, onde frontend e backend coexistem dentro do mesmo projeto Next.js. Essa escolha é proposital: como a aplicação é simples, sem autenticação e sem banco de dados, manter tudo em um único repositório reduz a complexidade de infraestrutura e facilita o deploy.

3.2 Frontend
------------

**Framework:** Next.js 14 com App Router

**Estilização:** Tailwind CSS

**Linguagem:** TypeScript

O frontend consiste em uma única página (Single Page Application --- SPA) com dois estados principais: o estado inicial com o campo de entrada centralizado, e o estado de resultado após a análise. A interface prioriza acessibilidade: fontes grandes, cores de alto contraste, botões claros, e feedback visual durante o processamento (loading). Não há navegação complexa, menus ou áreas restritas.

3.3 Backend (API Routes)
------------------------

**Runtime:** Python/FastAPI

O backend expõe dois endpoints principais:

-   **POST /api/analyze:** Recebe o texto ou URL do usuário, faz a validação de entrada, e orquestra o fluxo de análise. Se for URL, aciona primeiro o serviço de scraping; depois, envia o texto para a API da IA.

-   **POST /api/scrape:** Endpoint interno que recebe uma URL e retorna o conteúdo textual extraído da página, usando Axios para buscar o HTML e Cheerio para parsear e extrair o texto relevante.

3.4 Banco de Dados
------------------

O VeriFact não utiliza banco de dados. Toda análise é processada em tempo real e o resultado é retornado diretamente ao usuário, sem persistência. Isso simplifica a infraestrutura e elimina preocupações com LGPD/dados pessoais, já que nenhum dado do usuário é armazenado.

Opcionalmente, no futuro, pode-se implementar um cache temporário com Redis ou armazenamento em memória para evitar reanálises de URLs idênticas em curto intervalo de tempo.

3.5 Integração com IA
---------------------

**Provedor primário:** API da OpenAI (modelo GPT-4o-mini)

A integração com o LLM segue o padrão de prompt engineering estruturado. O backend monta um prompt contendo: instruções claras sobre o papel da IA (analisar indícios de fake news), o texto a ser analisado, e o formato de saída esperado (JSON estruturado). Esse prompt é enviado via chamada HTTP para a API do provedor escolhido.

O modelo retorna um JSON com a pontuação, os trechos sinalizados e as explicações. O backend então faz o parsing desse JSON e o retorna ao frontend para renderização.

Não há uso de agentes autônomos, RAG (Retrieval-Augmented Generation) ou MCPs nesta versão. A IA opera como um serviço de análise sob demanda, chamada uma única vez por requisição.

3.6 Hospedagem e Deploy
-----------------------

**Plataforma:** Vercel (plano gratuito Hobby)

**CI/CD:** Deploy automático via GitHub

A cada push na branch principal do repositório, a Vercel realiza o build e o deploy automaticamente. As API Routes são executadas como Serverless Functions, o que elimina a necessidade de gerenciar servidores e escala automaticamente com a demanda.
