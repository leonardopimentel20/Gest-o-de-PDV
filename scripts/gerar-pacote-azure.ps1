$ErrorActionPreference = 'Stop'
$origem = Split-Path -Parent $PSScriptRoot
$entregas = Join-Path $origem 'entregas'
$identificador = [Guid]::NewGuid().ToString('N')
$pasta = Join-Path $entregas ('azure-' + $identificador)
New-Item -ItemType Directory -Path $pasta -Force | Out-Null
foreach ($nome in @('server.js', 'db.js', 'package.json', 'package-lock.json', 'AZURE.md')) {
    Copy-Item -LiteralPath (Join-Path $origem $nome) -Destination $pasta
}
foreach ($nome in @('public', 'middleware', 'utils')) {
    Copy-Item -LiteralPath (Join-Path $origem $nome) -Destination $pasta -Recurse
}
# Apenas fontes: o Azure instala as dependências para Linux durante o build.
$zip = Join-Path $entregas ('PDV-AZURE-' + $identificador + '.zip')
Compress-Archive -Path (Join-Path $pasta '*') -DestinationPath $zip
# Remove somente os arquivos temporários criados nesta execução.
$pastaResolvida = [IO.Path]::GetFullPath($pasta)
$limite = [IO.Path]::GetFullPath($entregas) + [IO.Path]::DirectorySeparatorChar
if (!$pastaResolvida.StartsWith($limite, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destino temporario invalido' }
Remove-Item -LiteralPath $pastaResolvida -Recurse -Force
Write-Output "Pacote de demonstracao criado: $zip"
