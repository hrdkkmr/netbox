<#
.SYNOPSIS
  Opt-in Windows helper for NetBox Phase 6 LAN / Mobile Hotspot forwarding into WSL 2.

.DESCRIPTION
  Under default WSL 2 NAT networking, binding FastAPI to 0.0.0.0 inside WSL 2 does NOT
  expose port 8000 to external Wi-Fi or Windows Mobile Hotspot clients.
  This script inspects the current WSL 2 eth0 IPv4 address and either:
    - Shows the exact commands (default -DryRun / no switches)
    - Applies netsh portproxy + Windows Defender Firewall inbound rule when invoked with -Apply (Admin PowerShell)
    - Removes the portproxy + firewall rule when invoked with -Remove (Admin PowerShell)

  IMPORTANT: NetBox NEVER runs this script automatically. Always review before running with -Apply.
#>
param(
    [int]$Port = 8000,
    [string]$Distro = "Ubuntu",
    [switch]$Apply,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$RuleName = "NetBox LAN Port $Port"

if ($Remove) {
    Write-Host "[NetBox] Removing Windows portproxy and firewall rule for TCP port $Port..." -ForegroundColor Yellow
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port | Out-Null
    Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    Write-Host "[NetBox] Removed forwarding and firewall rule '$RuleName'." -ForegroundColor Green
    exit 0
}

$rawEth0 = (wsl -d $Distro -e ip -4 -o addr show eth0) -join " "
$wslIp = ""
if ($rawEth0 -match "inet\s+(\d+\.\d+\.\d+\.\d+)") {
    $wslIp = $Matches[1]
}
if (-not $wslIp) {
    Write-Error "Could not detect WSL 2 eth0 IPv4 address for distro '$Distro'. Ensure WSL is running."
    exit 1
}

Write-Host "=== NetBox Windows <-> WSL 2 LAN Forwarding Helper ===" -ForegroundColor Cyan
Write-Host "Detected WSL 2 ($Distro) eth0 IP : $wslIp"
Write-Host "Target TCP Port                  : $Port"
Write-Host "Windows LAN / Hotspot IPv4s      :"
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notlike "*WSL*" } |
    ForEach-Object { Write-Host "  - $($_.InterfaceAlias): http://$($_.IPAddress):$Port/" }

$portProxyCmd = "netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port"
$fwCmd = "New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -Action Allow"

if (-not $Apply) {
    Write-Host "`n[DRY RUN] No system firewall or portproxy rules were modified." -ForegroundColor Yellow
    Write-Host "To enable LAN/Hotspot access, re-run in an Administrator PowerShell with -Apply, or run:"
    Write-Host "  $portProxyCmd"
    Write-Host "  $fwCmd"
    Write-Host "`nTo remove later:"
    Write-Host "  .\scripts\windows\setup_lan_forward.ps1 -Port $Port -Remove"
    exit 0
}

Write-Host "`n[NetBox] Applying portproxy + Private-network inbound firewall rule..." -ForegroundColor Green
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$Port 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$Port connectaddress=$wslIp connectport=$Port
if (-not (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Profile Private -Action Allow | Out-Null
}

Write-Host "[NetBox] Done! Verify active forwarding rules:" -ForegroundColor Green
netsh interface portproxy show v4tov4
