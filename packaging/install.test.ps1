# Tests install.ps1 as people run it, on Windows, in the PowerShell this runs in (CI runs it in Windows
# PowerShell 5.1 and in PowerShell 7): a release from GitHub installed and run, the user's PATH changed once,
# the irm | iex form leaving the session's settings alone, and a download whose sum isn't the release's
# refused, with nothing installed.
#
#     .\packaging\install.test.ps1 [-Version 1.11.0] [-Sum <its moth-windows.exe's SHA-256>]
param(
    [string] $Version = '1.11.0',
    [string] $Sum = '0d6204ab7a8cc6451a2bb5e70c8366092eb0909113fc778b6b50de9c21929265'
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'install.ps1'
$work = Join-Path ([IO.Path]::GetTempPath()) ('moth-install-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Set-Content -LiteralPath (Join-Path $work 'hello.moth') -Value 'say "Hello from " "install.ps1"'
Write-Host "PowerShell $($PSVersionTable.PSVersion)"

function Assert([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "FAILED: $Message" }
    Write-Host "ok: $Message"
}
function Get-UserPath {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    try { return [string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Close() }
}
function Get-Count([string] $Folder) {
    return @((Get-UserPath) -split ';' | Where-Object { $_.TrimEnd('\') -eq $Folder.TrimEnd('\') }).Count
}

try {
    # a release, by version, as a script with options
    $dir = Join-Path $work 'a'
    & $script -Version $Version -InstallDir $dir
    $moth = Join-Path $dir 'moth.exe'
    Assert ((Get-FileHash $moth -Algorithm SHA256).Hash -eq $Sum.ToUpperInvariant()) "moth.exe is $Version's moth-windows.exe"
    Assert ((Get-Count $dir) -eq 1) 'its folder is on the user PATH'
    Assert (($env:Path -split ';') -contains $dir) "and on this session's PATH"
    Push-Location $work
    try { $said = & $moth run hello.moth } finally { Pop-Location }
    Assert ($said -eq 'Hello from install.ps1') "it runs a program: $said"

    # again, over the moth that's there: PATH has it once still
    & $script -Version "v$Version" -InstallDir $dir
    Assert ((Get-Count $dir) -eq 1) 'its folder is on the user PATH once, after installing twice'
    Assert (-not (Test-Path (Join-Path $dir 'moth.exe.old'))) 'no moth.exe.old is left'

    # irm | iex: the latest release, its options from the environment, and the session's settings as they were
    $dir2 = Join-Path $work 'b'
    $env:MOTH_INSTALL_DIR = $dir2
    $env:MOTH_NO_MODIFY_PATH = '1'
    $before = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Get-Content -Raw -LiteralPath $script | Invoke-Expression
    Assert ($ErrorActionPreference -eq 'Continue') 'iex left $ErrorActionPreference as it was'
    Assert ($null -eq $variableNoOneSet) 'iex left strict mode off'
    $ErrorActionPreference = $before
    Remove-Item Env:MOTH_INSTALL_DIR, Env:MOTH_NO_MODIFY_PATH
    Assert (Test-Path (Join-Path $dir2 'moth.exe')) 'iex installed the latest moth'
    Assert ((Get-Count $dir2) -eq 0) '-NoModifyPath (MOTH_NO_MODIFY_PATH=1) left PATH alone'

    # a release whose SHA256SUMS.txt doesn't have moth-windows.exe's sum: nothing is installed
    $fake = Join-Path $work 'releases\download\v9.8.7'
    New-Item -ItemType Directory -Path $fake | Out-Null
    Set-Content -LiteralPath (Join-Path $fake 'moth-windows.exe') -Value 'not moth'
    Set-Content -LiteralPath (Join-Path $fake 'SHA256SUMS.txt') -Value ("{0}  moth-windows.exe" -f ('2' * 64))
    $dir3 = Join-Path $work 'c'
    $refused = $null
    try {
        & $script -Version 9.8.7 -InstallDir $dir3 -ReleasesUrl ([Uri] (Join-Path $work 'releases')).AbsoluteUri
    } catch {
        $refused = $_.Exception.Message
    }
    Assert ($refused -match "isn't the release's, so nothing was installed") "a wrong sum is refused: $refused"
    Assert (-not (Test-Path (Join-Path $dir3 'moth.exe'))) 'and nothing was installed'
    Assert ((Get-Count $dir3) -eq 0) 'nor PATH changed'
} finally {
    # leave the user PATH as it was
    foreach ($folder in @((Join-Path $work 'a'), (Join-Path $work 'b'), (Join-Path $work 'c'))) {
        $kept = @((Get-UserPath) -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $folder })
        [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
    }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'install.ps1 works'
