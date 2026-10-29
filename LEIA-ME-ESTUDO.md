# Caderno de Estudo (fork do Caderno, licença MIT)

Fork de https://github.com/miguelaopt/caderno (ver LICENSE, mantida) para a UAB (`https://elearning.uab.pt`).

## Fase 1 (esta versão)
- **Espelho do Moodle** com a numeração da página da cadeira (`1`, `1.1`, `1.1.1`), incluindo subsecções do Moodle 4.5.
  Os ficheiros ficam em pastas reais no disco (`<cadeira>/1 - Tema/1.1 - Recursos/1.1.1 - ...`) e a app mostra-os agrupados por essas pastas em **Materiais**.
- **Páginas** e **Livros** do Moodle são guardados como HTML offline (imagens embebidas, sem scripts, abertos num sandbox).
- **Vídeos** alojados no Moodle (mp4, webm, mp3…, até 200 MB) ficam offline e reproduzem na app. YouTube/Vimeo/externos: ainda não (fase seguinte).
- **PUC**: procura o PUC (livro, página, PDF), lê as datas de e-fólios, trabalhos, testes e exames/avaliação global e cria prazos
  marcados "lido do PUC, confirma a data" (aparecem em Hoje → Próximos prazos).

## Executar
    npm ci
    npm start                      # abre http://localhost:<porta> (indica MOODLE_URL=https://elearning.uab.pt)
    npm run desktop:dev            # janela Electron
    npm run desktop:dist           # instalador Windows (corre no Windows)
    npm run desktop:dist:linux     # AppImage (corre no Linux)
    npm test

## Próximas fases
2. Avisos automáticos (calendário e notificações do Moodle: testes, mini-testes, e-fólios novos).
3. Resumos e apontamentos por cadeira, também para páginas/livros (já são analisados como os PDFs).
4. Conversa com o Claude sobre a matéria. Usa a chave de API do utilizador (a do Caderno), que é separada da subscrição Claude.ai.

Não testado contra o Moodle real da UAB; o PUC deve ser sempre confirmado.
