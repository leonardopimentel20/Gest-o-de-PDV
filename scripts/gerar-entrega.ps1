$ErrorActionPreference = 'Stop'
$origem = Split-Path -Parent $PSScriptRoot
$destino = Join-Path (Split-Path -Parent $origem) 'PDV-CLIENTE'
if (Test-Path -LiteralPath $destino) { throw 'PDV-CLIENTE ja existe. Preserve ou retire a entrega anterior antes de gerar outra.' }
New-Item -ItemType Directory -Path $destino | Out-Null
$arquivos = @('server.js', 'db.js', 'package.json', 'package-lock.json', 'iniciar.vbs', 'backup-agora.cmd', '.env.example', 'LEIA-ME-CLIENTE.md')
foreach ($arquivo in $arquivos) { Copy-Item -LiteralPath (Join-Path $origem $arquivo) -Destination $destino }
foreach ($pasta in @('public', 'middleware', 'utils', 'node_modules')) {
    Copy-Item -LiteralPath (Join-Path $origem $pasta) -Destination $destino -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $destino 'scripts') | Out-Null
foreach ($script in @('iniciar.ps1', 'backup-banco.js', 'diagnosticar-banco.js')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $script) -Destination (Join-Path $destino 'scripts')
}
# O pacote do cliente nao inclui a suite de desenvolvimento.
$manifesto = Get-Content -LiteralPath (Join-Path $destino 'package.json') -Raw | ConvertFrom-Json
$manifesto.scripts.PSObject.Properties.Remove('test')
$json = $manifesto | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $destino 'package.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Entrega pronta em $destino. Coloque o .env do cliente antes de iniciar."
