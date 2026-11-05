# Installs moth on Windows (x64) from a release on GitHub: it downloads moth-windows.exe and the release's
# SHA256SUMS.txt, checks the one against the other, saves it as moth.exe in your own programs folder, and adds
# that folder to your PATH. It needs no administrator. In PowerShell:
#
#     irm https://raw.githubusercontent.com/samyyy2423/moth/main/packaging/install.ps1 | iex
#
# A release other than the latest, or another folder, through the environment (irm ... | iex takes no options):
#
#     $env:MOTH_VERSION = "1.11.0"; $env:MOTH_INSTALL_DIR = "C:\Tools\Moth"; irm ... | iex
#
# or as a script: .\install.ps1 -Version 1.11.0 -InstallDir C:\Tools\Moth -NoModifyPath. MOTH_RELEASES_URL says
# where the releases are, for a mirror or a test; else GitHub's. To check who made the download, not only that it
# arrived whole, see docs/verifying-releases.md.
param(
    [string] $Version = $env:MOTH_VERSION,
    [string] $InstallDir = $env:MOTH_INSTALL_DIR,
    [switch] $NoModifyPath = ($env:MOTH_NO_MODIFY_PATH -eq '1'),
    [string] $ReleasesUrl = $env:MOTH_RELEASES_URL
)

# in a scope of its own, so that run through iex it leaves the session's settings as they were
& {
    Set-StrictMode -Version 3.0
    $ErrorActionPreference = 'Stop'

    # a file from the web (or file://, for a test) into a file
    function Get-MothFile([string] $Url, [string] $Path) {
        $uri = [Uri] $Url
        if ($uri.IsFile) {
            Copy-Item -LiteralPath $uri.LocalPath -Destination $Path
            return
        }
        $progress = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue' # Windows PowerShell downloads far faster without the bar
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
        } finally {
            $ProgressPreference = $progress
        }
    }

    # the folder as PATH would hold it, to compare: variables expanded, no \ at the end, any case
    function Get-PathKey([string] $Folder) {
        return [Environment]::ExpandEnvironmentVariables($Folder).Trim().TrimEnd('\').ToLowerInvariant()
    }

    # adds the folder to the user's PATH in the registry, as it's kept there (%USERPROFILE% and the like left as
    # they are), once; says whether it did
    function Add-MothToPath([string] $Folder) {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
        try {
            $raw = [string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
            if ($raw -ne '') { $kind = $key.GetValueKind('Path') }
            $parts = @($raw -split ';' | Where-Object { $_.Trim() -ne '' })
            foreach ($part in $parts) {
                if ((Get-PathKey $part) -eq (Get-PathKey $Folder)) { return $false }
            }
            $key.SetValue('Path', (($parts + $Folder) -join ';'), $kind)
        } finally {
            $key.Close()
        }
        # setting a variable through .NET tells Windows' programs that the environment changed, so a terminal
        # opened from now on has the new PATH; this one, which tells them, is set and taken away again
        [Environment]::SetEnvironmentVariable('MOTH_INSTALLER', '1', 'User')
        [Environment]::SetEnvironmentVariable('MOTH_INSTALLER', $null, 'User')
        return $true
    }

    function Install-Moth {
        if ($env:OS -ne 'Windows_NT') {
            throw 'This installs moth on Windows; on Linux use install.sh (docs/installers.md).'
        }
        if (-not [Environment]::Is64BitOperatingSystem) {
            throw "moth's Windows releases are for 64-bit Windows; build moth from the source with node bootstrap.mjs."
        }
        # Windows PowerShell 5.1 may not offer TLS 1.2 by itself, which GitHub needs
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

        $releases = 'https://github.com/samyyy2423/moth/releases'
        if ($ReleasesUrl) { $releases = $ReleasesUrl.TrimEnd('/') }
        $wanted = ''
        if ($Version) { $wanted = $Version.Trim() -replace '^v', '' }
        if ($wanted) {
            if ($wanted -notmatch '^[0-9][0-9A-Za-z.-]*$') { throw "'$Version' isn't a version like 1.11.0." }
            $from = "$releases/download/v$wanted"
            $which = "moth $wanted"
        } else {
            $from = "$releases/latest/download"
            $which = 'the latest moth'
        }
        $folder = $InstallDir
        if (-not $folder) { $folder = Join-Path $env:LOCALAPPDATA 'Programs\Moth' }
        $folder = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($folder)

        $work = Join-Path ([IO.Path]::GetTempPath()) ('moth-install-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $work | Out-Null
        try {
            Write-Host "downloading $which from $from"
            $download = Join-Path $work 'moth-windows.exe'
            $sums = Join-Path $work 'SHA256SUMS.txt'
            Get-MothFile "$from/moth-windows.exe" $download
            Get-MothFile "$from/SHA256SUMS.txt" $sums

            $expected = $null
            foreach ($line in Get-Content -LiteralPath $sums) {
                if ($line -match '^\s*([0-9A-Fa-f]{64})\s+\*?moth-windows\.exe\s*$') {
                    $expected = $Matches[1].ToLowerInvariant()
                    break
                }
            }
            if (-not $expected) { throw 'SHA256SUMS.txt has no sum for moth-windows.exe, so nothing was installed.' }
            $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expected) {
                throw "moth-windows.exe's SHA-256 is $actual, but SHA256SUMS.txt says ${expected}: the download isn't the release's, so nothing was installed."
            }
            Write-Host "checked: its SHA-256 is $actual, as SHA256SUMS.txt says"

            New-Item -ItemType Directory -Force -Path $folder | Out-Null
            $target = Join-Path $folder 'moth.exe'
            # a moth.exe that's running can't be written over, but it can be renamed out of the way
            $old = "$target.old"
            if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $old -Force }
            Move-Item -LiteralPath $download -Destination $target
            if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
            Write-Host "installed $which as $target"
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }

        $here = @($env:Path -split ';' | Where-Object { $_ -and (Get-PathKey $_) -eq (Get-PathKey $folder) })
        if ($NoModifyPath) {
            if (-not $here) { Write-Host "$folder isn't on your PATH: add it, or run $target" }
            return
        }
        if (Add-MothToPath $folder) { Write-Host "added $folder to your PATH" }
        if (-not $here) { $env:Path = "$folder;$env:Path" }
        Write-Host 'run: moth run hello.moth (in a new terminal, if another one is open)'
    }

    Install-Moth
}
