import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Fechamento da janela pelo sistema operacional, sem WebDriver.
 *
 * Vive fora do `helpers.mjs` de proposito: aquele arquivo importa
 * `@wdio/globals` e so carrega dentro do runner. Estes utilitarios servem tanto
 * ao spec (que asserta com a janela aberta) quanto ao probe nativo, que fecha o
 * app de verdade.
 *
 * REGRA DESTE ARQUIVO: o script PowerShell vai para um `.ps1` temporario e roda
 * com `-File`. Passar script multilinha por `-Command` (e caminho de Windows
 * dentro de template string) quebrou duas vezes: o escape come as quebras e o
 * `execFileSync` falha com "Command failed" sem dizer o motivo. Arquivo nao tem
 * escape.
 */

export function runPowershell(script, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mm-ps-'))
  const arquivo = join(dir, 'script.ps1')
  try {
    writeFileSync(arquivo, script, 'utf8')
    return execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', arquivo],
      { encoding: 'utf8', env: { ...process.env, ...env } },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** PID(s) do binario informado. */
export function appProcessIds(appBinary) {
  if (!appBinary) throw new Error('Caminho do binario do app nao informado.')
  const script = [
    // O `Path` do processo usa barra invertida; o env pode vir com barra normal.
    "$alvo = ($env:MM_APP_BINARY -replace '/', [char]92)",
    'Get-Process -Name mirrormind -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.Path -eq $alvo } |',
    '  ForEach-Object { $_.Id }',
    'exit 0',
  ].join('\r\n')
  const saida = runPowershell(script, { MM_APP_BINARY: appBinary })
  return saida
    .split(/\r?\n/)
    .map((linha) => Number(linha.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
}

/** `MainWindowHandle` do processo (0 enquanto a janela nao existe). */
export function windowHandle(pid) {
  const script = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { Write-Output '0' } else { Write-Output $p.MainWindowHandle }",
    'exit 0',
  ].join('\r\n')
  return Number(runPowershell(script).trim()) || 0
}

/** Envia WM_CLOSE — a mesma mensagem do X do titulo e do Alt+F4. */
export function requestWindowCloseFromOs(pid) {
  const script = [
    'Add-Type @"',
    '  using System;',
    '  using System.Runtime.InteropServices;',
    '  public class Win32Close {',
    '    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);',
    '  }',
    '"@',
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { Write-Output 'SEM_PROCESSO'; exit 0 }",
    '$h = $p.MainWindowHandle',
    "if ($h -eq 0) { Write-Output 'SEM_JANELA'; exit 0 }",
    'if ([Win32Close]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {',
    "  Write-Output 'ENVIADO'",
    '} else {',
    "  Write-Output 'FALHOU'",
    '}',
    'exit 0',
  ].join('\r\n')
  return runPowershell(script).trim()
}

/** Espera o processo sumir do sistema; devolve ms decorridos ou null. */
export async function waitForProcessExit(pid, timeoutMs = 20_000) {
  const inicio = Date.now()
  while (Date.now() - inicio < timeoutMs) {
    try {
      process.kill(pid, 0)
    } catch {
      return Date.now() - inicio
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return null
}

/** Espera a janela principal aparecer; devolve ms decorridos ou null. */
export async function waitForWindow(pid, timeoutMs = 60_000) {
  const inicio = Date.now()
  while (Date.now() - inicio < timeoutMs) {
    if (windowHandle(pid) !== 0) return Date.now() - inicio
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return null
}
