# Serial bridge for the Rotary Kiosk server (one process per COM port).
# Opens a COM port with .NET System.IO.Ports and relays bytes over stdin/stdout:
#   stdout:  OPEN | D <hex bytes> | S <bytes written> | ERR <message> | CLOSED
#   stdin :  W <hex bytes>  (write)   |   Q  (close and exit)
param(
  [Parameter(Mandatory = $true)][string]$Port,
  [int]$Baud = 9600,
  [int]$DataBits = 8,
  [string]$Parity = 'None',
  [string]$StopBits = 'One'
)
$ErrorActionPreference = 'Stop'
$out = [Console]::Out
function Say([string]$s) { $out.WriteLine($s); $out.Flush() }

$sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, ([System.IO.Ports.Parity]$Parity), $DataBits, ([System.IO.Ports.StopBits]$StopBits)
$sp.Handshake = 'None'
$sp.ReadTimeout = 50
$sp.WriteTimeout = 2000
$sp.DtrEnable = $true
$sp.RtsEnable = $true
try { $sp.Open() } catch { Say ("ERR " + $_.Exception.Message); exit 1 }
Say "OPEN"

$stdin = [Console]::In
$pending = $stdin.ReadLineAsync()
try {
  while ($true) {
    $n = $sp.BytesToRead
    if ($n -gt 0) {
      $buf = New-Object byte[] $n
      $got = $sp.Read($buf, 0, $n)
      if ($got -gt 0) { Say ("D " + [BitConverter]::ToString($buf, 0, $got)) }
      continue
    }
    if ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line -or $line -eq 'Q') { break }
      if ($line.StartsWith('W ')) {
        $hex = $line.Substring(2).Trim() -split '[- ]' | Where-Object { $_ -ne '' }
        $bytes = [byte[]]($hex | ForEach-Object { [Convert]::ToByte($_, 16) })
        $sp.Write($bytes, 0, $bytes.Length)
        Say ("S " + $bytes.Length)
      }
      $pending = $stdin.ReadLineAsync()
      continue
    }
    if (-not $sp.IsOpen) { throw 'Port closed' }
    Start-Sleep -Milliseconds 3
  }
} catch {
  Say ("ERR " + $_.Exception.Message)
} finally {
  try { $sp.Close() } catch { }
  Say "CLOSED"
}
