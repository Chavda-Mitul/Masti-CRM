#Requires -Version 5.1
<#
.SYNOPSIS
  Sets Chrome's rules for "Log in for me" on one office PC (docs/decisions/0024-portal-logins.md, component 4).

.DESCRIPTION
  Run it once on each office PC, from PowerShell opened as administrator. It writes Chrome's machine-wide rules
  (policies), so they hold for every Chrome profile on the PC:
  - installs the Masti CRM helper from the Chrome Web Store, so staff can't remove it or switch it off;
  - switches off the developer tools, the extensions page's developer mode, javascript: links, remote debugging and the
    chrome://net-export / net-internals traffic recorders, so nobody can read a password the helper typed;
  - switches off Chrome's password saving;
  - blocks every other extension, except the ones given in -AllowExtensions.
  It adds to the lists already there and leaves every other rule alone. -Remove takes back only what it set. -WhatIf
  shows the changes without making them, and needs no administrator. Helper/office-pc/README.md has the whole setup.

.PARAMETER HelperId
  The helper's ID in the Chrome Web Store: 32 letters from a to p.

.PARAMETER AllowExtensions
  IDs of the other extensions the staff need (Masti's list), each 32 letters from a to p.

.PARAMETER Remove
  Takes the rules away again.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Set-ChromeRules.ps1 -HelperId abcdefghijklmnopabcdefghijklmnop

.EXAMPLE
  .\Set-ChromeRules.ps1 -HelperId abcdefghijklmnopabcdefghijklmnop -AllowExtensions ponmlkjihgfedcbaponmlkjihgfedcba -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string] $HelperId,

  [ValidatePattern('^[a-p]{32}$')]
  [string[]] $AllowExtensions = @(),

  [switch] $Remove
)

$ErrorActionPreference = 'Stop'
$chrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
# Where Chrome fetches a Chrome Web Store extension from.
$storeUpdateUrl = 'https://clients2.google.com/service/update2/crx'

# Changing machine-wide rules needs an administrator; only looking (-WhatIf) doesn't.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal] $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $WhatIfPreference) {
  throw 'Open PowerShell as administrator (right-click it, Run as administrator), then run this again.'
}

# A Chrome list rule is a key whose values are named 1, 2, 3 and so on.
function Get-ListEntries([string] $name) {
  $key = Join-Path $chrome $name
  if (-not (Test-Path $key)) { return @() }
  $values = (Get-ItemProperty -Path $key).PSObject.Properties | Where-Object { $_.Name -match '^\d+$' }
  return @($values | ForEach-Object { [pscustomobject]@{ Slot = $_.Name; Value = [string] $_.Value } })
}

function Add-ToList([string] $name, [string] $value) {
  $entries = Get-ListEntries $name
  if (@($entries | Where-Object { $_.Value -eq $value }).Count -gt 0) {
    Write-Host "  $name already has $value"
    return
  }
  $slot = 1
  while (@($entries | Where-Object { $_.Slot -eq [string] $slot }).Count -gt 0) { $slot++ }
  if ($PSCmdlet.ShouldProcess("$chrome\$name", "add $value")) {
    $key = Join-Path $chrome $name
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    New-ItemProperty -Path $key -Name ([string] $slot) -Value $value -PropertyType String -Force | Out-Null
    Write-Host "  $name + $value"
  }
}

function Remove-FromList([string] $name, [string] $value) {
  foreach ($entry in @(Get-ListEntries $name | Where-Object { $_.Value -eq $value })) {
    if ($PSCmdlet.ShouldProcess("$chrome\$name", "remove $value")) {
      Remove-ItemProperty -Path (Join-Path $chrome $name) -Name $entry.Slot
      Write-Host "  $name - $value"
    }
  }
}

function Set-Number([string] $name, [int] $value) {
  if ($PSCmdlet.ShouldProcess($chrome, "set $name to $value")) {
    if (-not (Test-Path $chrome)) { New-Item -Path $chrome -Force | Out-Null }
    New-ItemProperty -Path $chrome -Name $name -Value $value -PropertyType DWord -Force | Out-Null
    Write-Host "  $name = $value"
  }
}

# Only while it still has the value this script set: someone may have changed it since.
function Remove-Number([string] $name, [int] $value) {
  if (-not (Test-Path $chrome)) { return }
  $current = (Get-ItemProperty -Path $chrome -ErrorAction SilentlyContinue).$name
  if ($null -ne $current -and [int] $current -eq $value -and $PSCmdlet.ShouldProcess($chrome, "remove $name")) {
    Remove-ItemProperty -Path $chrome -Name $name
    Write-Host "  $name removed"
  }
}

# The helper and any extensions Masti needs are force-installed, so staff can't remove them and the helper counts them
# as Masti's own (installType "admin") instead of refusing to type beside them.
$forceInstalls = @("$HelperId;$storeUpdateUrl") + ($AllowExtensions | ForEach-Object { "$_;$storeUpdateUrl" })
# 2: no developer tools anywhere. 1: no developer mode on the extensions page. 0: no password saving. 0: no remote
# debugging (--remote-debugging-port, another way into the page from outside Chrome).
$numbers = [ordered] @{ DeveloperToolsAvailability = 2; ExtensionDeveloperModeSettings = 1; PasswordManagerEnabled = 0; RemoteDebuggingAllowed = 0 }
# Pages that record everything Chrome sends (the password included) to a file, and typed javascript: links.
$blockedUrls = @('javascript://*', 'chrome://net-export', 'chrome://net-internals')

if ($Remove) {
  Write-Host 'Taking back the Masti CRM rules for Chrome:'
  foreach ($f in $forceInstalls) { Remove-FromList 'ExtensionInstallForcelist' $f }
  foreach ($name in $numbers.Keys) { Remove-Number $name $numbers[$name] }
  foreach ($url in $blockedUrls) { Remove-FromList 'URLBlocklist' $url }
  Remove-FromList 'ExtensionInstallBlocklist' '*'
  foreach ($id in @($HelperId) + $AllowExtensions) { Remove-FromList 'ExtensionInstallAllowlist' $id }
}
else {
  Write-Host 'Setting the Masti CRM rules for Chrome:'
  foreach ($f in $forceInstalls) { Add-ToList 'ExtensionInstallForcelist' $f }
  foreach ($name in $numbers.Keys) { Set-Number $name $numbers[$name] }
  foreach ($url in $blockedUrls) { Add-ToList 'URLBlocklist' $url }
  Add-ToList 'ExtensionInstallBlocklist' '*'
  foreach ($id in @($HelperId) + $AllowExtensions) { Add-ToList 'ExtensionInstallAllowlist' $id }
}

if ($WhatIfPreference) {
  Write-Host 'Nothing was changed (-WhatIf).'
}
else {
  Write-Host 'Done. Close every Chrome window, open Chrome again, and check chrome://policy.'
}
