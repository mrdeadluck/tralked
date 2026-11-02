<#
.SYNOPSIS
  Cria (ou remove) as tarefas do Agendador de Tarefas do Windows que rodam o robo de noticias do Tralked.

.DESCRIPTION
  Tarefas criadas (nome da pasta de trabalho: a pasta "ROBO NOTICIAS", pai deste script):
    Tralked Robo - Coleta   a cada 30 minutos, nos minutos :20 e :50, sem fim: pnpm coleta
    Tralked Robo - Publica  todo dia as 06:00, 07:00 ... 23:00: pnpm publica
    Tralked Robo - Resumo   todo dia as 00:10, resumo do dia anterior: pnpm resumo ontem

  Cada tarefa roda "cmd /c pnpm ...", entao o PATH resolve o pnpm. As tarefas rodam com o usuario logado ou
  nao (S4U, sem guardar senha) quando o Windows permite; se nao permitir, rodam so com o usuario logado. O
  script diz qual dos dois valeu. Rodar de novo substitui as tarefas existentes. Cada tarefa grava a saida no
  seu proprio log: data\logs\agendador-coleta.log, agendador-publica.log e agendador-resumo.log. (Um log so
  para todas fazia a coleta falhar quando comecava no mesmo minuto da publicacao: o cmd nao abre para escrita
  um arquivo que outro cmd ja esta escrevendo.) A coleta roda nos minutos :20 e :50, longe das :00 da
  publicacao, para as duas nao disputarem o banco no mesmo instante.

  Fuso: os horarios sao do relogio deste PC; o robo decide a grade de publicacao em America/Sao_Paulo.

.PARAMETER Remover
  Remove as tres tarefas em vez de criar.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefas.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-tarefas.ps1 -Remover
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Remover
)

$ErrorActionPreference = 'Stop'

$RoboDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$NomeColeta = 'Tralked Robo - Coleta'
$NomePublica = 'Tralked Robo - Publica'
$NomeResumo = 'Tralked Robo - Resumo'
$Nomes = @($NomeColeta, $NomePublica, $NomeResumo)

if ($Remover) {
  foreach ($nome in $Nomes) {
    if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $nome -Confirm:$false
      Write-Host "Removida: $nome"
    } else {
      Write-Host "Nao existia: $nome"
    }
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

New-Item -ItemType Directory -Force -Path (Join-Path $RoboDir 'data\logs') | Out-Null

function New-RoboAction([string]$Comando, [string]$Log) {
  # cmd /c expande %PATH% na hora de rodar; a saida vai para o log proprio da tarefa (um arquivo por tarefa:
  # dois cmd escrevendo no mesmo arquivo ao mesmo tempo fazem o segundo falhar antes de rodar o comando).
  $argumento = '/c set "PATH={0};%PATH%" && {1} >> data\logs\{2} 2>&1' -f $prefixoPath, $Comando, $Log
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

# Coleta: a cada 30 minutos, nos minutos :20 e :50 (longe das :00 da publicacao), sem data final (sem
# RepetitionDuration a repeticao nao termina).
$gatilhoColeta = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(20) -RepetitionInterval (New-TimeSpan -Minutes 30)

# Publica: um gatilho diario por hora, das 06:00 as 23:00 (18 horarios).
$gatilhosPublica = foreach ($hora in 6..23) {
  New-ScheduledTaskTrigger -Daily -At ('{0:00}:00' -f $hora)
}

# Resumo: 00:10, sobre o dia anterior.
$gatilhoResumo = New-ScheduledTaskTrigger -Daily -At '00:10'

$tarefas = @(
  @{ Nome = $NomeColeta;  Comando = 'pnpm coleta';       Log = 'agendador-coleta.log';  Gatilhos = $gatilhoColeta;    Limite = 55;  Descricao = 'Coleta, triagem e fila do robo de noticias do Tralked (a cada 30 minutos, :20 e :50).' }
  @{ Nome = $NomePublica; Comando = 'pnpm publica';      Log = 'agendador-publica.log'; Gatilhos = @($gatilhosPublica); Limite = 55;  Descricao = 'Publica a melhor materia da fila (06:00 a 23:00, de hora em hora).' }
  @{ Nome = $NomeResumo;  Comando = 'pnpm resumo ontem'; Log = 'agendador-resumo.log';  Gatilhos = $gatilhoResumo;   Limite = 30;  Descricao = 'Resumo diario do robo de noticias, por e-mail (00:10, dia anterior).' }
)

$modos = @{}
foreach ($t in $tarefas) {
  $modos[$t.Nome] = Register-RoboTask -Nome $t.Nome -Action (New-RoboAction $t.Comando $t.Log) `
    -Triggers $t.Gatilhos -Settings (New-RoboSettings $t.Limite) -Descricao $t.Descricao
  Write-Host "Criada: $($t.Nome)"
}

Write-Host ''
Write-Host "Pasta de trabalho: $RoboDir"
Write-Host "Usuario: $usuario"
Write-Host 'Logs: data\logs\agendador-coleta.log, agendador-publica.log e agendador-resumo.log'
$todosS4U = -not ($modos.Values | Where-Object { $_ -ne 'S4U' })
if ($todosS4U) {
  Write-Host 'Modo: rodam COM o usuario logado ou nao (S4U, sem guardar senha).'
} else {
  Write-Host 'Modo: rodam SO enquanto o usuario estiver logado (o Windows recusou o modo logado ou nao).'
  Write-Host 'Para rodar sem login, abra o Agendador de Tarefas, edite cada tarefa e marque "Executar estando o usuario conectado ou nao".'
}
Write-Host 'Para remover: instalar-tarefas.ps1 -Remover'
