# Politica de Flakiness

Esta politica preserva a confianca nos gates do MirrorMind. Um teste e considerado suspeito de flakiness quando o mesmo codigo e ambiente produzem falha e sucesso sem uma mudanca relevante que explique o resultado.

## Regra do gate

- A primeira falha reprova o gate. Aprovacao em uma nova execucao nao apaga a falha original.
- Retries automaticos permanecem desativados. O frontend executa com `--retry=0`; o runner Rust nao aplica retries.
- E proibido liberar o gate adicionando `skip`, reduzindo assercoes ou capturando uma falha sem propaga-la.
- Repeticoes sao permitidas apenas durante a investigacao e devem registrar quantas execucoes falharam.

## Diagnostico preservado

Depois que ao menos uma suite comeca a executar, o job `validate` publica o artefato `test-diagnostics-ubuntu` por 14 dias, inclusive quando a suite falha. Falhas anteriores, como checkout ou setup, permanecem apenas no log da execucao. O artefato contem:

- `frontend.log` e `frontend.junit.xml`, quando a suite frontend chegou a executar;
- `rust.log`, quando a suite Rust chegou a executar;
- nomes dos testes, mensagens, stack traces e saida capturada pelos runners.

Os comandos autoritativos da CI sao:

```powershell
npm run test:ci:frontend
npm run test:ci:rust
```

Para investigar dependencia de ordem no frontend, execute com shuffle e registre o seed exibido:

```powershell
npm run test:ci:frontend -- --sequence.shuffle
```

Para medir recorrencia no Windows sem esconder nenhuma falha:

```powershell
$diretorio = "test-results/stability/frontend"
New-Item -ItemType Directory -Force $diretorio | Out-Null
$falhas = @()
1..20 | ForEach-Object {
  $iteracao = $_
  $log = "$diretorio/$iteracao.log"
  $junit = "$diretorio/$iteracao.junit.xml"
  npm exec vitest -- run --retry=0 --reporter=default --reporter=junit "--outputFile.junit=$junit" *> $log
  $codigo = $LASTEXITCODE
  Get-Content $log
  if ($codigo -ne 0) { $falhas += $iteracao }
}
Write-Host "Iteracoes frontend com falha: $($falhas -join ', ')"
if ($falhas.Count -gt 0) { throw "$($falhas.Count) de 20 iteracoes frontend falharam" }
```

```powershell
$diretorio = "test-results/stability/rust"
New-Item -ItemType Directory -Force $diretorio | Out-Null
$falhas = @()
1..20 | ForEach-Object {
  $iteracao = $_
  $log = "$diretorio/$iteracao.log"
  cargo test --manifest-path src-tauri/Cargo.toml nome_do_teste --no-fail-fast -- --nocapture *> $log
  $codigo = $LASTEXITCODE
  Get-Content $log
  if ($codigo -ne 0) { $falhas += $iteracao }
}
Write-Host "Iteracoes Rust com falha: $($falhas -join ', ')"
if ($falhas.Count -gt 0) { throw "$($falhas.Count) de 20 iteracoes Rust falharam" }
```

## Triagem e responsabilidade

1. Abra uma issue com o template `Teste instavel` no primeiro caso confirmado de falha seguida de sucesso sem correcao relacionada.
2. Informe teste, plataforma, execucoes da CI, artefatos, comando de reproducao e taxa observada de falha. Remova tokens, caminhos pessoais e conteudo privado de Vault antes de anexar evidencias; prefira vincular o artefato da CI, que segue a visibilidade do repositorio.
3. Atribua um responsavel nominal e um prazo de no maximo sete dias. Testes de jornadas criticas ou integridade de arquivos devem ser tratados antes do proximo release candidate.
4. Classifique a causa provavel: estado compartilhado, tempo, concorrencia, ordem, ambiente, filesystem, dependencia externa ou defeito real do produto.
5. Corrija a causa no produto ou no isolamento do teste. Nao trate aumento de timeout como correcao sem evidencia de que o limite anterior contrariava o contrato.

Nao existe quarentena silenciosa. Uma excecao temporaria que retire um teste do gate exige aprovacao explicita, issue vinculada, responsavel, prazo e uma execucao separada ainda visivel. Enquanto essa infraestrutura nao existir, o teste permanece bloqueante.

## Criterio de encerramento

Uma issue pode ser encerrada quando:

- a causa raiz e a correcao estao documentadas;
- o teste passa 20 vezes consecutivas no ambiente em que a falha foi observada;
- logs/JUnit por iteracao e o seed original, quando aplicavel, ficam vinculados a issue;
- a suite completa passa normalmente, sem retry e sem skip;
- a CI autoritativa passa com os diagnosticos habilitados.
