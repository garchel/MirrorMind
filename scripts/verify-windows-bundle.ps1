[CmdletBinding()]
param(
    [string]$TargetDirectory = "src-tauri/target/debug",
    [string]$ManifestPath = "test-results/windows-bundle-manifest.json",
    [ValidateRange(1, 120)]
    [int]$StartupTimeoutSeconds = 30,
    [ValidateRange(10, 300)]
    [int]$InstallerTimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedTarget = (Resolve-Path -LiteralPath $TargetDirectory).Path
$buildApplicationPath = Join-Path $resolvedTarget "mirrormind.exe"
$installerDirectory = Join-Path $resolvedTarget "bundle/nsis"
if (-not (Test-Path -LiteralPath $buildApplicationPath -PathType Leaf)) {
    throw "Release application executable was not found at $buildApplicationPath"
}
if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
    throw "NSIS bundle directory was not found at $installerDirectory"
}

$installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter "*-setup.exe" -File)
if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in $installerDirectory; found $($installers.Count)"
}

$buildApplication = Get-Item -LiteralPath $buildApplicationPath
$installer = $installers[0]
if ($buildApplication.Length -le 0 -or $installer.Length -le 0) {
    throw "The release application or NSIS installer is empty"
}
if ($installer.Name -notmatch '^MirrorMind_(?<version>.+)_x64-setup\.exe$') {
    throw "Expected an x64 MirrorMind NSIS installer; found $($installer.Name)"
}
$bundleVersion = $Matches.version

$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$temporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path.TrimEnd('\', '/')
$installDirectory = [IO.Path]::GetFullPath(
    (Join-Path $temporaryRoot "mirrormind-bundle-smoke-$([Guid]::NewGuid().ToString('N'))")
)
if ([IO.Directory]::GetParent($installDirectory).FullName -ne $temporaryRoot) {
    throw "Smoke installation must be a direct child of the temporary directory"
}

$installedApplicationPath = Join-Path $installDirectory "mirrormind.exe"
$uninstallerPath = Join-Path $installDirectory "uninstall.exe"
$applicationProcess = $null
$cleanupFailure = $null

try {
    $installerProcess = Start-Process `
        -FilePath $installer.FullName `
        -ArgumentList @('/S', "/D=$installDirectory") `
        -PassThru
    if (-not $installerProcess.WaitForExit($InstallerTimeoutSeconds * 1000)) {
        Stop-Process -Id $installerProcess.Id -Force
        if (-not $installerProcess.WaitForExit(10000)) {
            throw "NSIS installer timed out and could not be stopped"
        }
        throw "NSIS installer did not finish within $InstallerTimeoutSeconds seconds"
    }
    if ($installerProcess.ExitCode -ne 0) {
        throw "NSIS installer exited with code $($installerProcess.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $installedApplicationPath -PathType Leaf)) {
        throw "NSIS did not install MirrorMind at $installedApplicationPath"
    }
    if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
        throw "NSIS did not install its cleanup executable at $uninstallerPath"
    }

    $installedApplication = Get-Item -LiteralPath $installedApplicationPath
    if ($installedApplication.Length -le 0) {
        throw "The application installed by NSIS is empty"
    }
    $installedApplicationHash = (Get-FileHash -LiteralPath $installedApplication.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

    $manifest = [ordered]@{
        schemaVersion = 1
        product = "MirrorMind"
        version = $bundleVersion
        architecture = "x64"
        sourceRevision = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { $null }
        application = [ordered]@{
            path = "installed/mirrormind.exe"
            bytes = $installedApplication.Length
            sha256 = $installedApplicationHash
        }
        installer = [ordered]@{
            path = "bundle/nsis/$($installer.Name)"
            bytes = $installer.Length
            sha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    $manifestParent = Split-Path -Parent $ManifestPath
    if ($manifestParent) {
        New-Item -ItemType Directory -Force -Path $manifestParent | Out-Null
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

    $applicationProcess = Start-Process -FilePath $installedApplication.FullName -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $windowReady = $false
    do {
        Start-Sleep -Milliseconds 500
        $applicationProcess.Refresh()
        if ($applicationProcess.HasExited) {
            throw "Installed MirrorMind exited during startup with code $($applicationProcess.ExitCode)"
        }
        if ($applicationProcess.MainWindowHandle -ne 0 -and $applicationProcess.MainWindowTitle -eq "MirrorMind") {
            $windowReady = $true
            break
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if (-not $windowReady) {
        throw "Installed MirrorMind did not expose its main window within $StartupTimeoutSeconds seconds"
    }
}
finally {
    if ($null -ne $applicationProcess -and -not $applicationProcess.HasExited) {
        try {
            Stop-Process -Id $applicationProcess.Id -Force
            if (-not $applicationProcess.WaitForExit(10000)) {
                throw "MirrorMind could not be stopped after the smoke"
            }
        }
        catch {
            $cleanupFailure = "Could not stop the smoke process: $_"
            Write-Warning $cleanupFailure
        }
    }

    if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
        try {
            $uninstallerProcess = Start-Process `
                -FilePath $uninstallerPath `
                -ArgumentList @('/S', "_?=$installDirectory") `
                -PassThru
            if (-not $uninstallerProcess.WaitForExit($InstallerTimeoutSeconds * 1000)) {
                Stop-Process -Id $uninstallerProcess.Id -Force
                if (-not $uninstallerProcess.WaitForExit(10000)) {
                    throw "NSIS uninstaller timed out and could not be stopped"
                }
                throw "NSIS uninstaller exceeded its timeout"
            }
            if ($uninstallerProcess.ExitCode -ne 0) {
                throw "NSIS uninstaller exited with code $($uninstallerProcess.ExitCode)"
            }
        }
        catch {
            $cleanupFailure = "Could not run the NSIS cleanup: $_"
            Write-Warning $cleanupFailure
        }
    }

    try {
        if (Test-Path -LiteralPath $installDirectory -PathType Container) {
            $installItem = Get-Item -LiteralPath $installDirectory -Force
            if (($installItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "The isolated smoke directory became a reparse point"
            }
            $currentInstallPath = [IO.Path]::GetFullPath($installItem.FullName)
            if ([IO.Directory]::GetParent($currentInstallPath).FullName -ne $temporaryRoot) {
                throw "The isolated smoke directory escaped the temporary root"
            }
            if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
                Remove-Item -LiteralPath $uninstallerPath -Force
            }
            $remainingItems = @(Get-ChildItem -LiteralPath $installDirectory -Force)
            if ($remainingItems.Count -ne 0) {
                throw "The NSIS uninstaller left $($remainingItems.Count) item(s) in the isolated directory"
            }
            Remove-Item -LiteralPath $installDirectory -Force
        }
    }
    catch {
        $cleanupFailure = "Could not remove the isolated smoke directory: $_"
        Write-Warning $cleanupFailure
    }
}

if ($cleanupFailure) {
    throw $cleanupFailure
}
Write-Output "Windows bundle smoke passed: $($installer.Name) installed and launched MirrorMind successfully."