# Proveniência

`navegador-orfao.txt`: saída de `ps -axo pid=,pgid=,command=` filtrada pelo perfil,
com um Chrome for Testing 151 (Playwright) lançado nesta máquina em 17/09/2026 do
mesmo jeito que o `ProcessRegistry` lança (`/bin/zsh -lc`, grupo de processos
próprio), com as MESMAS flags de `browser_command` e um `--user-data-dir` no
formato da Frota (`…/dev.vinicius.mycockpit/browser-profiles/<project_id>`). O zsh
fez `exec`: o principal tem pid igual ao grupo. Nove linhas: o principal (sem
`--type=`) e oito auxiliares. O caminho da
home foi trocado por `/Users/exemplo`; nada mais foi editado.
