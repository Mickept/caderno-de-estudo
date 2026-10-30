# Caderno de Estudo (fork do Caderno, licença MIT)

Fork de https://github.com/miguelaopt/caderno (ver LICENSE, mantida) para a UAB (`https://elearning.uab.pt`).

## Fase 1 (esta versão)
- **Espelho do Moodle** com a numeração da página da cadeira (`1`, `1.1`, `1.1.1`), incluindo subsecções do Moodle 4.5.
  Os ficheiros ficam em pastas reais no disco (`<cadeira>/1 - Tema/1.1 - Recursos/1.1.1 - ...`) e a app mostra-os agrupados por essas pastas em **Materiais**.
- **Páginas** e **Livros** do Moodle são guardados como HTML offline (imagens embebidas, sem scripts, abertos num sandbox).
- **Vídeos** alojados no Moodle (mp4, webm, mp3…, até 200 MB) ficam offline e reproduzem na app. YouTube/Vimeo/externos: ainda não (fase seguinte).
- **PUC**: procura o PUC (livro, página, PDF), lê as datas de e-fólios, trabalhos, testes e exames/avaliação global e cria prazos
  marcados "lido do PUC, confirma a data" (aparecem em Hoje → Próximos prazos).

## Fase 2: avisos automáticos
- A cada sincronização (ao ligar, manualmente e de 6 em 6 horas) lê o **calendário do Moodle** de cada cadeira escolhida
  (`core_calendar_get_action_events_by_course_by_timesort`): testes, mini-testes, e-fólios, exames e entregas.
  Se o Moodle da UAB não autorizar essa função, os prazos continuam a vir das atividades e do PUC.
- Avisa quando aparece um **prazo novo** e depois a **7 dias, 48 horas e no próprio dia**. Os avisos ficam em *Hoje* até carregares em "Percebi" e saem também como notificação do sistema.
- A primeira sincronização de uma cadeira não avisa de tudo de uma vez. A app reavalia os avisos de 15 em 15 minutos enquanto estiver aberta (as notificações precisam da app aberta).

## Fase 3: apontamentos e resumos por tema
- Página **Apontamentos**: notas tuas por cadeira (texto simples com `##` e `-`, com pré-visualização).
- **Resumir um tema com IA**: escolhes um tema (ou subtema) e a IA lê os materiais dele e escreve ideias principais, conceitos, o que não esquecer e perguntas para te testares. Fica guardado como apontamento editável.
- Precisa de chave de IA nas Definições (Anthropic/Claude, OpenAI, DeepSeek, Groq...). É uma chave de API, diferente da subscrição Claude.ai.

## Fase 4: conversa com o Claude
- Página **Conversa** (em Estudar): um chat contínuo por cadeira, com histórico guardado.
- Cada resposta usa os excertos mais relevantes dos teus materiais (com ligação à página), os teus apontamentos e os próximos prazos da cadeira, mais as últimas trocas da conversa.
- Escolhe o fornecedor nas Definições. Para usar o Claude, escolhe Anthropic e põe uma chave de API de console.anthropic.com (paga por utilização, separada da subscrição Claude.ai).

## Instalar no Windows
Ver INSTALAR-WINDOWS.md.

## Executar
    npm ci
    npm start                      # abre http://localhost:<porta> (indica MOODLE_URL=https://elearning.uab.pt)
    npm run desktop:dev            # janela Electron
    npm run desktop:dist           # instalador Windows (corre no Windows)
    npm run desktop:dist:linux     # AppImage (corre no Linux)
    npm test

## Próximas fases (fases 1 a 4 feitas)

Não testado contra o Moodle real da UAB; o PUC deve ser sempre confirmado.
