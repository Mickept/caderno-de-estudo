# Instalar no Windows

## Opção A: instalador (recomendado)
O instalador é compilado pelo GitHub, no teu fork, sem precisares de instalar nada.

1. No GitHub, abre o repositório `caderno-de-estudo` → separador **Actions**. Se aparecer o botão
   "I understand my workflows, go ahead and enable them", carrega nele (os forks vêm com isto desligado).
2. Escolhe o workflow **Windows desktop** → **Run workflow** (branch `main`) e espera uns 5 a 10 minutos.
3. Abre a execução terminada → no fundo, em **Artifacts**, descarrega `caderno-windows-x64` (um .zip).
4. Descomprime e corre `CadernoDeEstudo-...-Windows-x64.exe`. O Windows vai dizer "O Windows protegeu o seu PC"
   porque o instalador não está assinado: **Mais informações → Executar mesmo assim**.
5. Quando quiseres uma versão com ficheiro de download permanente, cria uma tag `v0.1.0` (no GitHub: Releases → Draft a new release → Choose a tag → criar `v0.1.0`). O workflow publica o instalador na release.

## Opção B: correr a partir do código (sem instalador)
1. Instala o [Node.js 24](https://nodejs.org) (versão LTS ou superior a 24, por causa do `node:sqlite`).
2. Num terminal PowerShell:

       git clone https://github.com/Mickept/caderno-de-estudo
       cd caderno-de-estudo
       npm ci
       npm run desktop:dev        # janela da app
       # ou: set MOODLE_URL=https://elearning.uab.pt && npm start   (abre no browser)

## Primeiro uso
1. Em **Cadeiras**, escreve o endereço do Moodle: `https://elearning.uab.pt` e carrega em guardar.
2. **Entrar pelo browser** → faz login na UAB (SSO) → quando o browser perguntar se pode abrir o Caderno, aceita.
3. Escolhe as cadeiras e **Guardar seleção**: a app descarrega a estrutura numerada, lê o PUC e cria os prazos.
4. (Opcional) Definições → chave de IA, para resumos, perguntas e flashcards.

Os dados ficam no teu computador. Se algo falhar no login ou no descarregamento, abre uma issue no teu repositório com a mensagem.
