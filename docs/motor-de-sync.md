# Motor de sincronização

Como o vault de uma pasta sobe para a nuvem (add-on de 10 GB) e desce em outro
computador, sem escolher pelo usuário e sem perder nada.

## As três peças

| Peça | Arquivo | Papel |
|---|---|---|
| Decisão | `src-tauri/src/cloud.rs` | identidade do vault, estado do último sync, `plan_sync` (o que fazer) |
| Execução | `src-tauri/src/cloud_sync.rs` | varredura do disco, subida/descida, cópia de conflito, área de recuperação |
| Transporte | `src-tauri/src/cloud_api.rs` | REST para metadados, Storage para conteúdo |

A separação não é enfeite: o plano é uma função pura (entra mapa, sai lista de
ações) e por isso é testável sem rede; o executor recebe um `CloudTransport`, que
nos testes é um mapa em memória.

## O que decide cada arquivo

O que manda é o **hash do conteúdo** (`sha256`), não a data do arquivo. Data mente:
copiar uma pasta, abrir um arquivo sem salvar e mudar de fuso alteram a data sem
alterar o conteúdo.

Existe um terceiro lado além de "local" e "nuvem": a **base**, guardada em
`.mirmind/cloud-state.json` como o hash de cada caminho no momento em que os dois
lados ficaram iguais. É ela que responde "quem mudou desde a última vez".

| local | nuvem | base | ação |
|---|---|---|---|
| existe | não existe | — | sobe |
| não existe | existe | — | desce |
| igual | igual | — | nada (reconhece a base) |
| mudou | igual | antigo | sobe |
| igual | mudou | antigo | desce |
| **mudou** | **mudou** | antigo | **conflito** |
| apagado na nuvem | marcado | igual | apaga aqui (vai para área de recuperação) |
| apagado na nuvem | marcado | mudou | volta para a nuvem |

## Nada é sobrescrito calado

Conflito não escolhe lado: a versão da nuvem vira uma cópia ao lado, com sufixo
`(conflito <instante>)`, e o arquivo local fica intacto. A base passa a apontar
para a versão remota, então a **próxima** sincronização sobe a sua versão — as
duas convivem, e a decisão de qual fica é do usuário, depois, editando.

## O objeto da nuvem é nomeado pelo hash

`<dono>/<vault>/<hash>` — não pelo caminho da nota.

Isso não é preferência estética: guardando por caminho, o segundo computador
**baixava a versão antiga**. O metadado já apontava para o hash novo, mas o
Storage servia o objeto em cache para o mesmo caminho. O teste de duas máquinas
pegou isso (o hash baixado não conferia com o metadado) e a correção foi mudar o
endereço, não contornar o cache.

Consequências, todas boas:

- conteúdo repetido em dois caminhos ocupa **um** objeto;
- a verificação de integridade é trivial: o nome do objeto é o hash;
- versão antiga deixa de existir como referência quando o metadado muda — e só é
  apagada se nenhum outro arquivo usa o mesmo conteúdo (`contar_usos`).

## Exclusão é marca, e apagar tem área de recuperação

Na nuvem, `deleted_at` marca a linha em vez de removê-la; sem isso o outro
computador "ressuscitaria" o arquivo na sincronização seguinte. No disco, o
arquivo excluído por outro computador vai para `.mirmind/cloud-deleted/<instante>/<caminho>`,
não para o lixo do sistema.

## Falha por arquivo não aborta o resto

O relatório (`SyncReport`) tem listas separadas: `uploaded`, `downloaded`,
`conflicts`, `deleted`, `skipped` (maior que o teto de 25 MB por arquivo) e
`failed`. Um anexo problemático não impede 300 notas de sincronizar.

A ordem de cada subida é **conteúdo, depois metadado**: se o metadado for recusado
(cota, por exemplo), o conteúdo recém-enviado é apagado. O contrário deixaria um
arquivo "existindo" na nuvem sem bytes.

## O que ainda falta

- comando IPC e a tela de vínculo (primeira sincronização com "manter os dois");
- verificar a cota antes de começar, para o erro aparecer no primeiro arquivo e
  não no meio;
- varredura de objetos órfãos (versões que nenhuma linha referencia).

## Como testar

```bash
# unidade (sem rede)
cargo test --manifest-path src-tauri/Cargo.toml --lib cloud

# contra a nuvem de verdade (conta de teste com o add-on ligado)
MIRRORMIND_TEST_SUPABASE_URL=... MIRRORMIND_TEST_SUPABASE_KEY=... \
MIRRORMIND_TEST_EMAIL=... MIRRORMIND_TEST_PASSWORD=... \
cargo test --manifest-path src-tauri/Cargo.toml --lib cloud_api::tests::live -- --ignored --nocapture
```

O teste `live_duas_maquinas` é o que importa: duas pastas temporárias, o mesmo
`local_id`, e o ciclo completo — A sobe, B baixa, B edita, A recebe, e a terceira
passada não faz nada.
