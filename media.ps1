# SneakPeek's music helper. Reads Windows' "now playing" (the media session behind the volume-key popup), so it
# works with Spotify, browsers, Apple Music, VLC... Prints one JSON line per change; reads commands from stdin:
# toggle | next | prev. Started by main.js; exits when SneakPeek closes its stdin.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # no "Preparing modules" noise on first run
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$NS = 'Windows.Media.Control'
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$IRAS = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$ICT = [Windows.Storage.Streams.IContentTypeProvider, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Get-Art($props) {
  try {
    if (-not $props.Thumbnail) { return $null }
    $ras = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # The stream arrives as a bare COM object, so call its methods through the WinRT interface types.
    $size = [uint64]$IRAS.GetProperty('Size').GetValue($ras)
    if ($size -eq 0 -or $size -gt 3MB) { return $null }
    $input = $IRAS.GetMethod('GetInputStreamAt').Invoke($ras, @([uint64]0))
    $dr = [Windows.Storage.Streams.DataReader]::new($input)
    $n = Await ($dr.LoadAsync([uint32]$size)) ([uint32])
    $bytes = New-Object byte[] $n
    $dr.ReadBytes($bytes); $dr.Dispose()
    $type = try { $ICT.GetProperty('ContentType').GetValue($ras) } catch { $null }
    if (-not $type) { $type = 'image/png' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

function Send($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

# Commands arrive on stdin. Reading it blocks in Windows PowerShell, so a background runspace reads lines into a queue.
$queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$reader = [runspacefactory]::CreateRunspace(); $reader.Open(); $reader.SessionStateProxy.SetVariable('queue', $queue)
$readPs = [powershell]::Create(); $readPs.Runspace = $reader
[void]$readPs.AddScript({ $in = [Console]::In; while ($null -ne ($line = $in.ReadLine())) { $queue.Enqueue($line) }; $queue.Enqueue('__eof__') })
[void]$readPs.BeginInvoke()
$lastKey = ''; $lastSent = [DateTime]::MinValue; $artTries = 0; $art = $null
while ($true) {
  # Commands from SneakPeek
  $cmd = $null
  while ($queue.TryDequeue([ref]$cmd)) {
    if ($cmd -eq '__eof__') { exit } # SneakPeek went away
    try {
      $s = $mgr.GetCurrentSession()
      if ($s) {
        switch ($cmd.Trim()) {
          'toggle' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
          'next'   { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
          'prev'   { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
        }
      }
    } catch {}
    $lastKey = '' # report the new state right away
  }

  try {
    $s = $mgr.GetCurrentSession()
    if (-not $s) {
      if ($lastKey -ne 'none') { Send @{ none = $true }; $lastKey = 'none' }
    } else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $status = $s.GetPlaybackInfo().PlaybackStatus.ToString()
      $tl = $s.GetTimelineProperties()
      $track = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
      $key = "$track|$status"
      if ($track -ne ($lastKey -replace '\|[^|]*$', '')) { $art = $null; $artTries = 0 }
      $newArt = $false
      if (-not $art -and $artTries -lt 6) { $artTries++; $art = Get-Art $p; $newArt = [bool]$art } # art often arrives a moment after the track
      if ($key -ne $lastKey -or $newArt -or ([DateTime]::Now - $lastSent).TotalSeconds -ge 5) {
        $msg = @{
          app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
          status = $status.ToLower()
          pos = [long]$tl.Position.TotalMilliseconds; dur = [long]($tl.EndTime - $tl.StartTime).TotalMilliseconds
          at = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        }
        if ($key -ne $lastKey -or $newArt) { $msg.art = $art } # only resend art when it changed
        Send $msg
        $lastKey = $key; $lastSent = [DateTime]::Now
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
