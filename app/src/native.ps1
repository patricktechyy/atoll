# Atoll helper for Windows PowerShell 5.1 (the fallback when the native helper can't be built).
# One JSON object per line on stdout; JSON commands on stdin.
# Each Windows feature is compiled separately, so if one fails (e.g. audio) the others still work,
# and the reason is reported to Atoll (Settings → Diagnostics).
#   -MediaOnly : only now-playing / album art (when the native "core" helper does everything else)
param([switch]$MediaOnly)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$out = [Console]::Out
function Emit($o) { try { $out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); $out.Flush() } catch {} }
function Diag($where, $msg) { Emit @{ type = 'diag'; where = $where; msg = "$msg" } }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$have = @{ win = $false; audio = $false; screen = $false; toasts = $false }

if (-not $MediaOnly) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Xml
  $refsForms = @([System.Windows.Forms.Form].Assembly.Location, [System.Drawing.Rectangle].Assembly.Location)
  $refsXml = @([System.Xml.XmlDocument].Assembly.Location)

  # ---- 1. Win32 basics: keyboard, foreground app, clipboard counter, paste, DPI ----
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AtollWin {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool SetProcessWorkingSetSize(IntPtr proc, IntPtr min, IntPtr max);
  public static void Trim(int pid) {
    IntPtr h = OpenProcess(0x0100 | 0x1000, false, pid);
    if (h == IntPtr.Zero) return;
    try { SetProcessWorkingSetSize(h, (IntPtr)(-1), (IntPtr)(-1)); } finally { CloseHandle(h); }
  }
  [DllImport("user32.dll")] static extern short GetKeyState(int key);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static uint ClipSeq() { return GetClipboardSequenceNumber(); }
  public static bool CapsOn() { return (GetKeyState(0x14) & 1) != 0; }
  public static string KeyboardLang() {
    try {
      uint pid;
      uint t = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      int lang = (int)((long)GetKeyboardLayout(t) & 0xFFFF);
      return new System.Globalization.CultureInfo(lang).TwoLetterISOLanguageName.ToUpperInvariant();
    } catch { return ""; }
  }
  static IntPtr lastFg = IntPtr.Zero; static string lastProc = "";
  public static string ForegroundProcess() {
    IntPtr h = GetForegroundWindow();
    if (h != lastFg) {
      lastFg = h; lastProc = "";
      uint pid; GetWindowThreadProcessId(h, out pid);
      try { lastProc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
    }
    return lastProc;
  }
  public static void Paste() {
    keybd_event(0x12, 0, 2, UIntPtr.Zero); keybd_event(0x10, 0, 2, UIntPtr.Zero);
    keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x56, 0, 0, UIntPtr.Zero);
    keybd_event(0x56, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }
}
'@
    $null = [AtollWin]::SetProcessDPIAware()
    $have.win = $true
  } catch { Diag 'win32' $_ }

  # ---- 2. Core Audio: volume, mute, output device ----
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _a(); int _b(); int _c(); int _d();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int _e();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int _f(); int _g(); int _h(); int _i();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume aev);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _a(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class AtollAudio {
  static IAudioEndpointVolume vol; static DateTime at = DateTime.MinValue;
  public static string DevId = ""; public static string DevName = "";
  static void Refresh() {
    if (vol != null && (DateTime.Now - at).TotalSeconds < 3) return;
    IMMDeviceEnumerator en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev; Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    string id; dev.GetId(out id);
    if (id != DevId) {
      DevId = id ?? ""; DevName = "";
      try {
        IPropertyStore ps;
        if (dev.OpenPropertyStore(0, out ps) == 0) {
          PROPERTYKEY key = new PROPERTYKEY(); key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); key.pid = 14;
          PROPVARIANT pv;
          if (ps.GetValue(ref key, out pv) == 0 && pv.vt == 31) DevName = Marshal.PtrToStringUni(pv.p);
        }
      } catch { }
    }
    Guid iid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out v));
    vol = v; at = DateTime.Now;
  }
  public static int Volume() { Refresh(); float f; vol.GetMasterVolumeLevelScalar(out f); return (int)Math.Round(f * 100); }
  public static bool Muted() { Refresh(); bool m; vol.GetMute(out m); return m; }
  public static void SetVolume(int p) { Refresh(); vol.SetMute(false, Guid.Empty); vol.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, p)) / 100f, Guid.Empty); }
  public static void Reset() { vol = null; }
}
'@
    $have.audio = $true
  } catch { Diag 'audio' $_ }

  # ---- 3. Full-screen check (needs Windows Forms for the screen bounds) ----
  try {
    Add-Type -ReferencedAssemblies $refsForms -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AtollScreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static bool ForegroundFullscreen() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return false;
    StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return false;
    RECT r; if (!GetWindowRect(h, out r)) return false;
    System.Drawing.Rectangle s = System.Windows.Forms.Screen.FromHandle(h).Bounds;
    return r.Left <= s.Left && r.Top <= s.Top && r.Right >= s.Right && r.Bottom >= s.Bottom;
  }
}
'@
    $have.screen = $true
  } catch { Diag 'fullscreen' $_ }

  # ---- 4. Windows notifications (reads Windows' own notification database, read-only) ----
  try {
    Add-Type -ReferencedAssemblies $refsXml -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class AtollToasts {
  [DllImport("winsqlite3.dll")] static extern int sqlite3_open_v2(byte[] file, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_close_v2(IntPtr db);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_busy_timeout(IntPtr db, int ms);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int n, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_step(IntPtr stmt);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll")] static extern long sqlite3_column_int64(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_column_bytes(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern IntPtr sqlite3_errmsg(IntPtr db);
  public static long LastId = -1; public static string Error = "";
  static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
  static string Col(IntPtr st, int i) {
    int n = sqlite3_column_bytes(st, i); IntPtr p = sqlite3_column_blob(st, i);
    if (p == IntPtr.Zero || n <= 0) return "";
    byte[] b = new byte[n]; Marshal.Copy(p, b, 0, n); return Encoding.UTF8.GetString(b);
  }
  public static List<string[]> Poll() {
    List<string[]> rows = new List<string[]>();
    string file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft\\Windows\\Notifications\\wpndatabase.db");
    if (!File.Exists(file)) { Error = "Notification database not found"; return rows; }
    IntPtr db;
    if (sqlite3_open_v2(Z(file), out db, 1, IntPtr.Zero) != 0) { Error = "Can't open notification database: " + Marshal.PtrToStringAnsi(sqlite3_errmsg(db)); sqlite3_close_v2(db); return rows; }
    try {
      sqlite3_busy_timeout(db, 300);
      string sql = LastId < 0 ? "SELECT IFNULL(MAX(Id),0) FROM Notification"
        : "SELECT n.Id, h.PrimaryId, n.Payload FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n.Id > " + LastId + " ORDER BY n.Id LIMIT 20";
      IntPtr st;
      if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) != 0) { Error = Marshal.PtrToStringAnsi(sqlite3_errmsg(db)); return rows; }
      while (sqlite3_step(st) == 100) {
        if (LastId < 0) { LastId = sqlite3_column_int64(st, 0); break; }
        long id = sqlite3_column_int64(st, 0); if (id > LastId) LastId = id;
        rows.Add(new string[] { id.ToString(), Col(st, 1), Col(st, 2) });
      }
      sqlite3_finalize(st); Error = "";
    } finally { sqlite3_close_v2(db); }
    return rows;
  }
  public static string[] Texts(string xml) {
    string title = "", body = "", attr = "";
    try {
      System.Xml.XmlDocument doc = new System.Xml.XmlDocument(); doc.LoadXml(xml);
      List<string> parts = new List<string>();
      foreach (System.Xml.XmlNode n in doc.SelectNodes("//binding/text")) {
        System.Xml.XmlAttribute pl = n.Attributes != null ? n.Attributes["placement"] : null;
        if (pl != null && pl.Value == "attribution") { attr = n.InnerText; continue; }
        if (n.InnerText.Trim().Length > 0) parts.Add(n.InnerText.Trim());
      }
      if (parts.Count > 0) title = parts[0];
      if (parts.Count > 1) body = String.Join(" · ", parts.GetRange(1, parts.Count - 1).ToArray());
    } catch { }
    return new string[] { title, body, attr };
  }
}
'@
    $have.toasts = $true
  } catch { Diag 'notifications' $_ }
}

# ---------- music: Windows media controls (WinRT) ----------
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  if ($task.Wait(4000)) { return $task.Result }
  return $null
}

$mgr = $null
try {
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
} catch { Diag 'media-init' $_ }

function Get-Session {
  if (-not $mgr) { return $null }
  $current = $mgr.GetCurrentSession()
  foreach ($s in $mgr.GetSessions()) { if (('' + $s.GetPlaybackInfo().PlaybackStatus) -eq 'Playing') { return $s } }
  return $current
}

$script:lastKey = ''; $script:artOk = $false; $script:artTries = 0; $script:artErr = ''
function Read-Thumbnail($props) {
  $st = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  if (-not $st -or $st.Size -le 0 -or $st.Size -ge 4MB) { return $null }
  $ct = $st.ContentType; if (-not $ct) { $ct = 'image/png' }
  $bytes = $null
  try {
    # way 1: as a .NET stream
    $s = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
    $ms = New-Object System.IO.MemoryStream
    $s.CopyTo($ms); $bytes = $ms.ToArray(); $s.Dispose()
  } catch {
    # way 2: WinRT DataReader
    $reader = [Windows.Storage.Streams.DataReader]::new($st.GetInputStreamAt(0))
    $n = Await ($reader.LoadAsync([uint32]$st.Size)) ([uint32])
    $bytes = New-Object byte[] $n
    $reader.ReadBytes($bytes)
  }
  return "data:$ct;base64," + [Convert]::ToBase64String($bytes)
}
function Send-Art($props, $key, $always) {
  $data = $null
  try { if ($props -and $props.Thumbnail) { $data = Read-Thumbnail $props } }
  catch { if ("$_" -ne $script:artErr) { $script:artErr = "$_"; Diag 'album-art' $_ } }
  if ($data -or $always) { Emit @{ type = 'art'; key = $key; data = $data } }
  return [bool]$data
}

function Read-Media {
  $s = Get-Session
  if (-not $s) { Emit @{ type = 'media'; active = $false }; $script:lastKey = ''; return }
  $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
  $playing = ('' + $pb.PlaybackStatus) -eq 'Playing'
  $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
  $pos = $tl.Position.TotalSeconds
  if ($playing -and $tl.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds }
  if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
  if ($pos -lt 0) { $pos = 0 }
  $title = ''; $artist = ''; $album = ''; $albumArtist = ''
  if ($props) { $title = $props.Title; $artist = $props.Artist; $album = $props.AlbumTitle; $albumArtist = $props.AlbumArtist }
  $app = $s.SourceAppUserModelId
  $key = "$title|$artist|$app"
  Emit @{
    type = 'media'; active = [bool]$title; title = $title; artist = $artist; album = $album; albumArtist = $albumArtist
    playing = $playing; position = [math]::Round($pos, 2); duration = [math]::Round($dur, 2)
    app = $app; key = $key; canSeek = [bool]$pb.Controls.IsPlaybackPositionEnabled
  }
  # Spotify & co. often publish the cover a moment after the title: keep asking for ~12 s
  if ($key -ne $script:lastKey) { $script:lastKey = $key; $script:artOk = $false; $script:artTries = 0 }
  if (-not $script:artOk -and $script:artTries -lt 12) { $script:artTries++; $script:artOk = Send-Art $props $key ($script:artTries -eq 1) }
}

# ---------- everything else ----------
$script:netOn = $false; $script:toastsOn = $false; $script:clip = [uint32]0; $script:fg = $null; $script:fs = $null
$script:sys = @{ v = -2; m = $null; caps = $null; lang = $null; dev = $null }

function Capture($c) {
  try {
    $bmp = New-Object System.Drawing.Bitmap([int]$c.w, [int]$c.h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$c.x, [int]$c.y, 0, 0, (New-Object System.Drawing.Size([int]$c.w, [int]$c.h)))
    $bmp.Save($c.file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Emit @{ type = 'captured'; id = $c.id; file = $c.file; ok = $true }
  } catch { Emit @{ type = 'captured'; id = $c.id; ok = $false; error = "$_" } }
}

function Invoke-Command2($line) {
  try { $c = $line | ConvertFrom-Json } catch { return }
  switch ($c.cmd) {
    'net' { $script:netOn = [bool]$c.on; return }
    'toasts' { $script:toastsOn = [bool]$c.on; return }
    'paste' { if ($have.win) { Start-Sleep -Milliseconds 60; [AtollWin]::Paste() }; return }
    'capture' { Capture $c; return }
    'trim' {
      if ($have.win) { foreach ($x in @($c.pids)) { try { [AtollWin]::Trim([int]$x) } catch {} } }
      [System.GC]::Collect()
      if ($have.win) { try { [AtollWin]::Trim($PID) } catch {} }
      Emit @{ type = 'mem'; ws = [System.Diagnostics.Process]::GetCurrentProcess().WorkingSet64; who = $(if ($MediaOnly) { 'media' } else { 'helper' }) }
      return
    }
    'setvol' { if ($have.audio) { try { [AtollAudio]::SetVolume([int]$c.v) } catch { [AtollAudio]::Reset() } }; return }
  }
  $s = Get-Session
  if (-not $s) { return }
  switch ($c.cmd) {
    'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
    'prev' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
    'seek' { $null = Await ($s.TryChangePlaybackPositionAsync([long]([double]$c.pos * 10000000))) ([bool]) }
    default { return }
  }
  Start-Sleep -Milliseconds 150
  Read-Media
}

function Read-System {
  $v = -1; $m = $false; $dev = ''; $devName = ''; $caps = $false; $lang = ''
  if ($have.audio) { try { $v = [AtollAudio]::Volume(); $m = [AtollAudio]::Muted(); $dev = [AtollAudio]::DevId; $devName = [AtollAudio]::DevName } catch { [AtollAudio]::Reset() } }
  if ($have.win) { $caps = [AtollWin]::CapsOn(); $lang = [AtollWin]::KeyboardLang() }
  if ($v -ne $sys.v -or $m -ne $sys.m -or $caps -ne $sys.caps -or $lang -ne $sys.lang -or $dev -ne $sys.dev) {
    $script:sys = @{ v = $v; m = $m; caps = $caps; lang = $lang; dev = $dev }
    Emit @{ type = 'system'; volume = $v; muted = $m; caps = $caps; lang = $lang; device = $devName; deviceId = $dev }
  }
}
function Read-Foreground {
  if (-not $have.win) { return }
  $p = [AtollWin]::ForegroundProcess()
  if ($p -ne $script:fg) { $script:fg = $p; Emit @{ type = 'fg'; proc = $p } }
}
function Read-Clipboard {
  if (-not $have.win) { return }
  $n = [AtollWin]::ClipSeq()
  if ($n -ne $script:clip) {
    $first = $script:clip -eq 0; $script:clip = $n
    if (-not $first) {
      # read the text here too, so Atoll has it even if its own read finds the clipboard locked
      $text = $null; $err = $null; $priv = $false
      for ($i = 0; $i -lt 3; $i++) {
        Start-Sleep -Milliseconds (80 + 150 * $i)
        try {
          Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
          $priv = [System.Windows.Forms.Clipboard]::ContainsData('ExcludeClipboardContentFromMonitorProcessing')
          if (-not $priv -and [System.Windows.Forms.Clipboard]::ContainsText()) { $text = [System.Windows.Forms.Clipboard]::GetText() }
          $err = $null; break
        } catch { $err = "$_" }
      }
      if ($text -and $text.Length -gt 20000) { $text = $text.Substring(0, 20000) }
      Emit @{ type = 'clip'; seq = $n; text = $text; private = [bool]$priv; error = $err }
    }
  }
}
function Read-Fullscreen {
  if (-not $have.screen) { return }
  $on = $false; try { $on = [AtollScreen]::ForegroundFullscreen() } catch {}
  if ($on -ne $script:fs) { $script:fs = $on; Emit @{ type = 'fullscreen'; on = $on } }
}
function Read-Net {
  $rx = [int64]0; $tx = [int64]0
  foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    $t = '' + $n.NetworkInterfaceType
    if (('' + $n.OperationalStatus) -eq 'Up' -and $t -ne 'Loopback' -and $t -ne 'Tunnel') { try { $st = $n.GetIPStatistics(); $rx += $st.BytesReceived; $tx += $st.BytesSent } catch {} }
  }
  Emit @{ type = 'net'; rx = $rx; tx = $tx; t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
}
$script:toastErr = $null
function Read-Toasts {
  if (-not $have.toasts) { return }
  $rows = [AtollToasts]::Poll()
  if ([AtollToasts]::Error -ne $script:toastErr) { $script:toastErr = [AtollToasts]::Error; Emit @{ type = 'toasts-status'; ok = (-not $script:toastErr); error = $script:toastErr } }
  foreach ($r in $rows) {
    $t = [AtollToasts]::Texts($r[2])
    if ($t[0] -or $t[1]) { Emit @{ type = 'toast'; id = $r[0]; app = $r[1]; title = $t[0]; body = $t[1]; attribution = $t[2] } }
  }
}

Emit @{ type = 'ready'; media = [bool]$mgr; native = $false; mediaOnly = [bool]$MediaOnly; parts = $have }

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$tick = 0
while ($true) {
  while ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { exit 0 }
    try { Invoke-Command2 $line } catch {}
    $pending = $stdin.ReadLineAsync()
  }
  if (-not $MediaOnly) {
    try { Read-System } catch {}
    try { Read-Foreground } catch {}
    try { Read-Clipboard } catch {}
    if ($tick % 2 -eq 0) { Read-Fullscreen }
    if ($netOn -and $tick % 8 -eq 0) { try { Read-Net } catch {} }
    if ($toastsOn -and $tick % 6 -eq 0) { try { Read-Toasts } catch { Emit @{ type = 'toasts-status'; ok = $false; error = "$_" } } }
  }
  if ($tick % 4 -eq 0) { try { Read-Media } catch { Emit @{ type = 'media'; active = $false } } }
  if ($tick % 120 -eq 0) {
    Emit @{ type = 'mem'; ws = [System.Diagnostics.Process]::GetCurrentProcess().WorkingSet64; who = $(if ($MediaOnly) { 'media' } else { 'helper' }) }
    if ($tick % 1200 -eq 0) { [System.GC]::Collect() }
  }
  $tick++
  Start-Sleep -Milliseconds 250
}
