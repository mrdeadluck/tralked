<#
.SYNOPSIS
  Cria (ou remove) a tarefa do Agendador de Tarefas do Windows que roda o robo de guias do Tralked.

.DESCRIPTION
  Tarefa criada (pasta de trabalho: a pasta "ROBO NOTICIAS", pai deste script):
    Tralked Robo - Guias   a cada 30 minutos, sem fim: pnpm guia (processa UM pedido da fila de guias)

  O robo so processa pedidos que o Lucas colocou na fila (/admin/guias/pedidos); sem pedido, a execucao termina
  em segundos com "nada na fila". Um pedido pode levar horas (muitas paginas com intervalo educado por site,
  imagens), por isso o limite da tarefa e de 3 horas e uma nova execucao e ignorada enquanto a anterior roda
  (-MultipleInstances IgnoreNew). O proprio robo segura uma trava (data-guias\guia.lock, vencida em 3 h).

  A tarefa roda "cmd /c pnpm guia", entao o PATH resolve o pnpm. Ela roda com o usuario logado ou nao (S4U,
  sem guardar senha) quando o Windows permite; se nao permitir, so com o usuario logado. O script diz qual dos
  dois valeu. Rodar de novo substitui a tarefa. A saida vai para o log proprio: data-guias\logs\agendador-guias.log.

.PARAMETER Remover
  Remove a tarefa em vez de criar.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefa-guias.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefa-guias.ps1 -Remover
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Remover
)

$ErrorActionPreference = 'Stop'

$RoboDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$Nome = 'Tralked Robo - Guias'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $Nome -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Nome -Confirm:$false
    Write-Host "Removida: $Nome"
  } else {
    Write-Host "Nao existia: $Nome"
  }
  return
}

# Pastas dos executaveis: o S4U pode nao carregar o PATH do usuario, entao elas vao na frente do PATH.
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $pnpm) { throw 'pnpm nao encontrado no PATH. Instale o pnpm (Node 24 ou mais novo) e rode de novo.' }
if (-not $node) { throw 'node nao encontrado no PATH. Instale o Node 24 ou mais novo e rode de novo.' }
$pastas = @(
  (Split-Path -Parent $pnpm.Source)
  (Split-Path -Parent $node.Source)
) | Select-Object -Unique
$prefixoPath = ($pastas -join ';')

New-Item -ItemType Directory -Force -Path (Join-Path $RoboDir 'data-guias\logs') | Out-Null

function New-RoboAction([string]$Comando, [string]$Log) {
  # cmd /c expande %PATH% na hora de rodar; a saida vai para o log proprio da tarefa.
  $argumento = '/c set "PATH={0};%PATH%" && {1} >> data-guias\logs\{2} 2>&1' -f $prefixoPath, $Comando, $Log
  New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argumento -WorkingDirectory $RoboDir
}

function New-RoboSettings([int]$LimiteMinutos) {
  New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $LimiteMinutos)
}

$usuario = '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME

# Tenta "rodar com o usuario logado ou nao" (S4U, sem senha); se o Windows recusar, so com o usuario logado.
function Register-RoboTask([string]$Nome, $Action, $Triggers, $Settings, [string]$Descricao) {
  foreach ($tipo in @('S4U', 'Interactive')) {
    try {
      $principal = New-ScheduledTaskPrincipal -UserId $usuario -LogonType $tipo -RunLevel Limited
      Register-ScheduledTask -TaskName $Nome -Action $Action -Trigger $Triggers -Settings $Settings `
        -Principal $principal -Description $Descricao -Force | Out-Null
      return $tipo
    } catch {
      if ($tipo -eq 'Interactive') { throw }
    }
  }
}

# A cada 30 minutos, nos minutos :05 e :35 (longe da coleta de noticias em :20/:50), sem data final
# (sem RepetitionDuration a repeticao nao termina).
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30)

$modo = Register-RoboTask -Nome $Nome -Action (New-RoboAction 'pnpm guia' 'agendador-guias.log') `
  -Triggers $gatilho -Settings (New-RoboSettings 180) `
  -Descricao 'Robo de guias do Tralked: processa um pedido da fila de guias (a cada 30 minutos, ate 3 horas por execucao).'
Write-Host "Criada: $Nome"

Write-Host ''
Write-Host "Pasta de trabalho: $RoboDir"
Write-Host "Usuario: $usuario"
Write-Host 'Log: data-guias\logs\agendador-guias.log'
if ($modo -eq 'S4U') {
  Write-Host 'Modo: roda COM o usuario logado ou nao (S4U, sem guardar senha).'
} else {
  Write-Host 'Modo: roda SO enquanto o usuario estiver logado (o Windows recusou o modo logado ou nao).'
  Write-Host 'Para rodar sem login, abra o Agendador de Tarefas, edite a tarefa e marque "Executar estando o usuario conectado ou nao".'
}
Write-Host 'Para remover: instalar-tarefa-guias.ps1 -Remover'
