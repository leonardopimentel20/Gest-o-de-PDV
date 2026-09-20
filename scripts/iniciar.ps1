param([switch]$SemNavegador)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $raiz
$porta = 3000
$envArquivo = Join-Path $raiz '.env'
if (Test-Path -LiteralPath $envArquivo) {
    foreach ($linha in Get-Content -LiteralPath $envArquivo) {
        if ($linha -match '^\s*PORT\s*=\s*["'']?(\d+)') { $porta = [int]$Matches[1] }
    }
}
$url = "http://127.0.0.1:$porta"
$sha = [System.Security.Cryptography.SHA256]::Create()
$identificador = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($raiz.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant()
$sha.Dispose()
$mutex = New-Object System.Threading.Mutex($false, "Local\LojaSistemaPDV$porta")
$adquiriu = $false
try {
    if (!(Test-Path -LiteralPath $envArquivo)) { throw 'Arquivo .env ausente. Copie o .env da instalacao do cliente para esta pasta antes de abrir o PDV.' }
    if (!(Test-Path -LiteralPath (Join-Path $raiz 'node_modules\express\package.json'))) { throw 'Dependencias ausentes. Execute npm.cmd ci na pasta do sistema.' }
    $adquiriu = $mutex.WaitOne(60000)
    if (!$adquiriu) { throw 'Outra inicializacao ainda esta em andamento. Aguarde e tente novamente.' }
    $pronto = $false
    try {
        $saude = Invoke-RestMethod "$url/health" -TimeoutSec 3
        $pronto = $saude.servico -eq 'loja-sistema' -and $saude.instancia -eq $identificador
    } catch { }
    if (!$pronto) {
        $ocupada = Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction SilentlyContinue
        if ($ocupada) { throw "A porta $porta esta ocupada por outra instancia ou o banco esta indisponivel. Feche a outra versao do PDV ou confira o MySQL. Nenhum processo foi encerrado." }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $logs = Join-Path $raiz 'logs'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $processo = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $raiz 'server.js') + '"') -WorkingDirectory $raiz -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'servidor.log') -RedirectStandardError (Join-Path $logs 'erros.log') -PassThru
        for ($i = 0; $i -lt 40; $i++) {
            Start-Sleep -Milliseconds 500
            $processo.Refresh()
            if ($processo.HasExited) { throw 'O servidor nao iniciou. Consulte logs\erros.log.' }
            try {
                $saude = Invoke-RestMethod "$url/health" -TimeoutSec 2
                if ($saude.servico -eq 'loja-sistema' -and $saude.instancia -eq $identificador) { $pronto = $true; break }
            } catch { }
        }
    }
    if (!$pronto) { throw 'O sistema nao ficou pronto. Confira o servico MySQL e logs\erros.log.' }
    if (!$SemNavegador) { Start-Process "$url/login.html" }
    Write-Output "Sistema pronto em $url"
} catch {
    if ($SemNavegador) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Inicializacao do Sistema PDV', 'OK', 'Error') | Out-Null
} finally {
    if ($adquiriu) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
