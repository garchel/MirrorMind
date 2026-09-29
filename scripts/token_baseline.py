"""Baseline imutavel dos gates de token.

Os quatro verificadores comparam o worktree contra um "antes" para provar
que nada mudou. Esse "antes" nao pode ser HEAD: depois que a tokenizacao
entrou num commit, HEAD ja contem o estado tokenizado, e os gates passam
a comparar o tokenizado contra si mesmo (verificacoes: 0, falso verde).

Por isso o baseline e fixado no commit ANTERIOR a tokenizacao
(93a8a75^) e nunca se move. Exporta:

  BASELINE  -> ref do "antes"
  git_show() -> texto de um arquivo nesse ref
"""
import os
import subprocess

# 93a8a75 = "feat(design-system): 3 camadas de token"; o pai dele e o
# ultimo estado com hex literais. Se este commit for reescrito, atualize
# a constante -- e a unica coisa a fazer aqui.
BASELINE = '93a8a75^'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git_show(rel, ref=None):
    """Texto de `rel` no baseline. None se nao existia la."""
    ref = ref or BASELINE
    p = subprocess.run(['git', 'show', f'{ref}:{rel}'],
                       cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        return None
    return p.stdout.decode('utf-8', 'replace')


def require_baseline():
    """Falha com explicacao em vez de devolver hex vazio.

    Os gates comparam o worktree contra este commit. Num clone raso
    (fetch-depth: 1) o commit nao existe e a comparacao vira lista
    vazia -- que produz o pior resultado possivel: o gate acusa
    divergencia em TUDO, ou (pior) passa sem comparar nada. Verificar
    a existencia aqui transforma isso em erro legivel.
    """
    p = subprocess.run(['git', 'rev-parse', '--verify', f'{BASELINE}^{{commit}}'],
                       cwd=ROOT, capture_output=True)
    if p.returncode != 0:
        print(f'FALHA: o baseline {BASELINE} nao existe neste clone.')
        print('  Os gates de token comparam o worktree contra esse commit.')
        print('  Em CI, garanta checkout completo (sem fetch-depth: 1).')
        return False
    return True


def resolve_ref(ref=None):
    """SHA do baseline, para relatar nos gates."""
    r = ref or BASELINE
    p = subprocess.run(['git', 'rev-parse', r], cwd=ROOT, capture_output=True)
    return p.stdout.decode().strip() if p.returncode == 0 else r
