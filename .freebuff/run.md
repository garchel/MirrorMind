# Run doc — MirrorMind (web preview)

Como reproduzir o ambiente e subir o servidor de desenvolvimento para o
Preview. Este workspace é o próprio checkout principal (não há worktree
separado), então não há artefatos a copiar de outro checkout.

## Reproduzir os artefatos

- **Dependências**: `npm install` na raiz (usa `package-lock.json`). Se
  `node_modules` já existir, nada a fazer.
- **`.env`**: já existe na raiz do checkout e **não deve ser versionado nem
  ter valores registrados aqui** (contém segredo). Se faltar, copie o
  `C:\Users\paulo\OneDrive\Documentos\MirrorMind\.env` original (ou peça ao
  dono do projeto).
- **Build**: nenhum passo de build é necessário para `vite dev`. O app web é
  um mock (fluxo Tauri fica desativado no navegador) — serve só para
  visualizar a UI.

## Rodar o servidor

- Porta padrão do Vite: **5173**. Se estiver ocupada (outro `vite`/`tauri dev`
  ativo), use uma porta livre, ex.: **5174**.
- Comando (na raiz):

  ```bash
  npm run dev -- --port 5174 --strictPort
  ```

- Detach (Windows, PowerShell — o wrapper npm não resolve shims):

  ```powershell
  powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev','--','--port','5174','--strictPort') -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
  ```

  Substitua `<log>` pelo caminho do log do preview (ex.:
  `C:\Users\paulo\OneDrive\Documentos\MirrorMind\.freebuff\preview-<id>.log`).
  stdout e stderr devem ir para arquivos diferentes. O processo que escuta a
  porta é o `node` filho (confirme com
  `Get-NetTCPConnection -LocalPort 5174 -State Listen`); use o pid dele ao
  registrar o preview.

- Confirmação: a URL deve responder `200` em
  `http://localhost:<porta>/` e o log mostrar `VITE vX ready` + `Local: http://localhost:<porta>/`.
