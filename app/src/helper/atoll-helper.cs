// Atoll native helper. Atoll compiles this once on your PC with Windows' built-in C# compiler
// (C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe, C# 5), so it needs no install.
// It replaces the PowerShell helper (same JSON-lines protocol) and uses far less memory.
//
// stdout: one JSON object per line   stdin: one JSON command per line
// Reports: now playing (Windows media controls) + album art, volume/mute/output device,
// Caps Lock, keyboard language, foreground app, full-screen state, clipboard changes,
// network counters (on request), Windows app notifications (on request), own memory.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
#if !NO_MEDIA
using Windows.Foundation;
using Windows.Media.Control;
#endif
// Build variants: full (music via Windows media controls), or NO_MEDIA "core" if WinRT can't be compiled
// on this PC; Atoll then runs only the music part in PowerShell.

// ---------------------------------------------------------------- Core Audio (volume)
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback cb);
  [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback cb);
  int _c(); int _d();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int _e();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int _f(); int _g(); int _h(); int _i();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

// Windows calls this the moment the volume or mute changes (each key press), instead of us
// noticing on the next 250 ms poll: the volume HUD then follows your keys without stepping.
[Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComVisible(true)]
public interface IAudioEndpointVolumeCallback {
  [PreserveSig] int OnNotify(IntPtr data);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class VolumeWatch : IAudioEndpointVolumeCallback {
  public int OnNotify(IntPtr data) {
    try {
      // AUDIO_VOLUME_NOTIFICATION_DATA: GUID (16) | BOOL bMuted (4) | float fMasterVolume (4) | …
      bool muted = Marshal.ReadInt32(data, 16) != 0;
      float f = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, 20)), 0);
      Program.OnVolume((int)Math.Round(f * 100), muted);
    } catch { }
    return 0;
  }
}

[StructLayout(LayoutKind.Sequential)]
struct PROPERTYKEY { public Guid fmtid; public int pid; }

[StructLayout(LayoutKind.Sequential)]
struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }

[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out int c);
  int GetAt(int i, out PROPERTYKEY k);
  int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume aev);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int _a();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

static class Audio {
  static IAudioEndpointVolume vol;
  static IAudioEndpointVolume watched; static string watchedId = null;
  static readonly VolumeWatch watcher = new VolumeWatch();
  public static string DevId = "";
  public static string DevName = "";
  static DateTime at = DateTime.MinValue;

  static void Refresh() {
    if (vol != null && (DateTime.Now - at).TotalSeconds < 3) return;
    IMMDeviceEnumerator en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    string id;
    dev.GetId(out id);
    if (id != DevId) {
      DevId = id ?? "";
      DevName = "";
      try {
        IPropertyStore ps;
        if (dev.OpenPropertyStore(0, out ps) == 0) {
          PROPERTYKEY key = new PROPERTYKEY();
          key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
          key.pid = 14;
          PROPVARIANT pv;
          if (ps.GetValue(ref key, out pv) == 0 && pv.vt == 31) DevName = Marshal.PtrToStringUni(pv.p);
        }
      } catch { }
    }
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume v;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out v));
    vol = v;
    at = DateTime.Now;
    if (watchedId != DevId) { // (re)subscribe to change notifications for the current output device
      try { if (watched != null) watched.UnregisterControlChangeNotify(watcher); } catch { }
      watched = null; watchedId = DevId;
      try { IAudioEndpointVolume w; if (dev.Activate(ref iid, 23, IntPtr.Zero, out w) == 0 && w.RegisterControlChangeNotify(watcher) == 0) watched = w; } catch { }
    }
  }

  public static int Volume() { Refresh(); float f; vol.GetMasterVolumeLevelScalar(out f); return (int)Math.Round(f * 100); }
  public static bool Muted() { Refresh(); bool m; vol.GetMute(out m); return m; }
  public static void SetVolume(int p) { Refresh(); vol.SetMute(false, Guid.Empty); vol.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, p)) / 100f, Guid.Empty); }
  public static void Reset() { vol = null; }
}

// ---------------------------------------------------------------- Win32
static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern short GetKeyState(int key);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll")] public static extern bool IsClipboardFormatAvailable(uint format);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] public static extern bool SetProcessWorkingSetSize(IntPtr proc, IntPtr min, IntPtr max);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  // Give an idle process's memory back to Windows: its pages leave RAM (they come back on demand
  // when the notch is used again). PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION.
  public static void Trim(int pid) {
    IntPtr h = OpenProcess(0x0100 | 0x1000, false, pid);
    if (h == IntPtr.Zero) return;
    try { SetProcessWorkingSetSize(h, (IntPtr)(-1), (IntPtr)(-1)); } finally { CloseHandle(h); }
  }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}

// ---------------------------------------------------------------- Windows notifications
// Windows keeps every toast in %LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db.
// We read new rows read-only with Windows' own winsqlite3.dll.
static class Toasts {
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

  public static long LastId = -1;
  public static string Error = "";

  static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
  static string Col(IntPtr st, int i) {
    int n = sqlite3_column_bytes(st, i);
    IntPtr p = sqlite3_column_blob(st, i);
    if (p == IntPtr.Zero || n <= 0) return "";
    byte[] b = new byte[n];
    Marshal.Copy(p, b, 0, n);
    return Encoding.UTF8.GetString(b);
  }

  public static List<string[]> Poll() {
    List<string[]> rows = new List<string[]>();
    string file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft\\Windows\\Notifications\\wpndatabase.db");
    if (!File.Exists(file)) { Error = "Notification database not found"; return rows; }
    IntPtr db;
    if (sqlite3_open_v2(Z(file), out db, 1, IntPtr.Zero) != 0) {
      Error = "Can't open notification database: " + Marshal.PtrToStringAnsi(sqlite3_errmsg(db));
      sqlite3_close_v2(db);
      return rows;
    }
    try {
      sqlite3_busy_timeout(db, 300);
      string sql = LastId < 0
        ? "SELECT IFNULL(MAX(Id),0) FROM Notification"
        : "SELECT n.Id, h.PrimaryId, n.Payload FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n.Id > " + LastId + " ORDER BY n.Id LIMIT 20";
      IntPtr st;
      if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) != 0) { Error = Marshal.PtrToStringAnsi(sqlite3_errmsg(db)); return rows; }
      while (sqlite3_step(st) == 100) {
        if (LastId < 0) { LastId = sqlite3_column_int64(st, 0); break; }
        long id = sqlite3_column_int64(st, 0);
        if (id > LastId) LastId = id;
        rows.Add(new string[] { id.ToString(), Col(st, 1), Col(st, 2) });
      }
      sqlite3_finalize(st);
      Error = "";
    } finally { sqlite3_close_v2(db); }
    return rows;
  }

  public static string[] Texts(string xml) {
    string title = "", body = "", attr = "";
    try {
      System.Xml.XmlDocument doc = new System.Xml.XmlDocument();
      doc.LoadXml(xml);
      List<string> parts = new List<string>();
      foreach (System.Xml.XmlNode n in doc.SelectNodes("//binding/text")) {
        System.Xml.XmlAttribute pl = n.Attributes != null ? n.Attributes["placement"] : null;
        if (pl != null && pl.Value == "attribution") { attr = n.InnerText; continue; }
        if (n.InnerText.Trim().Length > 0) parts.Add(n.InnerText.Trim());
      }
      if (parts.Count > 0) title = parts[0];
      if (parts.Count > 1) body = String.Join(" \u00b7 ", parts.GetRange(1, parts.Count - 1).ToArray());
    } catch { }
    return new string[] { title, body, attr };
  }
}

#if UIA
// ---------------------------------------------------------------- Apple Music's own controls
// Apple Music for Windows tells Windows that seeking and "previous" are off and ignores those requests,
// and the position it reports jumps around. Its window's own progress slider (UI Automation id
// "LCDScrubber", "Scrubber" in the Mini Player) holds the real position in seconds and can be moved;
// its back button is "TransportControl_SkipBack". This uses the accessibility interface screen readers
// use: no mouse movement, the window isn't raised, and it works while Apple Music is minimised.
static class AppleUia {
  static System.Windows.Automation.AutomationElement scrubber, back;
  static DateTime lastMiss = DateTime.MinValue;
  public static void Reset() { scrubber = null; back = null; lastMiss = DateTime.MinValue; }
  static System.Windows.Automation.AutomationElement FindIn(System.Windows.Automation.AutomationElement win, string id) {
    return win.FindFirst(System.Windows.Automation.TreeScope.Descendants,
      new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.AutomationIdProperty, id));
  }
  static bool Alive(System.Windows.Automation.AutomationElement e) {
    if (e == null) return false;
    try { string id = e.Current.AutomationId; return id != null; } catch { return false; }
  }
  public static bool Ensure() {
    if (Alive(scrubber)) return true;
    scrubber = null; back = null;
    if ((DateTime.UtcNow - lastMiss).TotalSeconds < 15) return false; // looking is slow-ish: not more often after a miss
    try {
      foreach (Process p in Process.GetProcessesByName("AppleMusic")) {
        System.Windows.Automation.AutomationElementCollection wins = System.Windows.Automation.AutomationElement.RootElement.FindAll(
          System.Windows.Automation.TreeScope.Children,
          new System.Windows.Automation.PropertyCondition(System.Windows.Automation.AutomationElement.ProcessIdProperty, p.Id));
        foreach (System.Windows.Automation.AutomationElement w in wins) {
          System.Windows.Automation.AutomationElement sc = FindIn(w, "LCDScrubber") ?? FindIn(w, "Scrubber");
          if (sc == null) continue;
          scrubber = sc; back = FindIn(w, "TransportControl_SkipBack");
          return true;
        }
      }
    } catch { }
    lastMiss = DateTime.UtcNow;
    return false;
  }
  static System.Windows.Automation.RangeValuePattern Range() {
    object pat;
    if (scrubber != null && scrubber.TryGetCurrentPattern(System.Windows.Automation.RangeValuePattern.Pattern, out pat)) return (System.Windows.Automation.RangeValuePattern)pat;
    return null;
  }
  // position and length as the slider has them (seconds), or false
  public static bool Read(out double value, out double min, out double max) {
    value = 0; min = 0; max = 0;
    try {
      if (!Ensure()) return false;
      System.Windows.Automation.RangeValuePattern r = Range();
      if (r == null) return false;
      value = r.Current.Value; min = r.Current.Minimum; max = r.Current.Maximum;
      return true;
    } catch { scrubber = null; return false; }
  }
  public static bool Seek(double value) {
    try {
      if (!Ensure()) return false;
      System.Windows.Automation.RangeValuePattern r = Range();
      if (r == null || r.Current.IsReadOnly) return false;
      r.SetValue(Math.Max(r.Current.Minimum, Math.Min(r.Current.Maximum, value)));
      return true;
    } catch { scrubber = null; return false; }
  }
  public static bool Back() {
    try {
      if (!Ensure() || back == null) return false;
      object pat;
      if (!back.TryGetCurrentPattern(System.Windows.Automation.InvokePattern.Pattern, out pat)) return false;
      ((System.Windows.Automation.InvokePattern)pat).Invoke();
      return true;
    } catch { back = null; return false; }
  }
}
#endif

// ---------------------------------------------------------------- main loop
static class Program {
  static readonly JavaScriptSerializer J = new JavaScriptSerializer();
  static StreamWriter Out;
  static readonly object OutLock = new object();
  static readonly ConcurrentQueue<string> Cmds = new ConcurrentQueue<string>();
  static volatile bool InputClosed = false;
  static bool netOn = false, toastsOn = false;
  static volatile bool amWatch = false; // Atoll asks for Apple Music's slider position while it plays
  static string amTrack = "";
#if !NO_MEDIA
  static GlobalSystemMediaTransportControlsSessionManager mgr;
#endif

  static Dictionary<string, object> D(params object[] kv) {
    Dictionary<string, object> d = new Dictionary<string, object>();
    for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
    return d;
  }
  static void Emit(Dictionary<string, object> d) {
    string s;
    try { s = J.Serialize(d); } catch { return; }
    lock (OutLock) { try { Out.WriteLine(s); Out.Flush(); } catch { } }
  }
  static void Safe(Action a) { try { a(); } catch { } }

#if !NO_MEDIA
  // Wait for a WinRT async call by polling its status. (Not AsTask(): that extension lives in
  // System.Runtime.WindowsRuntime, which refers to the SDK-only union "Windows" metadata, so Windows'
  // built-in compiler fails with CS0012 on many PCs.)
  static T Wait<T>(IAsyncOperation<T> op, int ms) {
    if (op == null) return default(T);
    DateTime end = DateTime.UtcNow.AddMilliseconds(ms);
    while (op.Status == AsyncStatus.Started) {
      if (DateTime.UtcNow > end) { try { op.Cancel(); } catch { } return default(T); }
      Thread.Sleep(4);
    }
    return op.Status == AsyncStatus.Completed ? op.GetResults() : default(T);
  }
#endif

  [MTAThread]
  static int Main() {
    AppDomain.CurrentDomain.UnhandledException += (sender, e) => {
      try { Console.Error.WriteLine("atoll-helper crashed: " + e.ExceptionObject); } catch { }
    };
    try { Win.SetProcessDPIAware(); } catch { } // real pixels for screenshots & full-screen checks
    J.MaxJsonLength = int.MaxValue;
    Out = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    Out.AutoFlush = true;
    Thread reader = new Thread(() => {
      try {
        StreamReader inp = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = inp.ReadLine()) != null) Cmds.Enqueue(line);
      } catch { }
      InputClosed = true;
    });
    reader.IsBackground = true;
    reader.Start();

#if !NO_MEDIA
    Safe(InitMedia);
    Emit(D("type", "ready", "media", mgr != null, "native", true, "core", false));
#else
    Emit(D("type", "ready", "media", false, "native", true, "core", true));
#endif

    int tick = 0;
    while (!InputClosed) {
      string c;
      while (Cmds.TryDequeue(out c)) { string cc = c; Safe(() => Command(cc)); }
      Safe(ReadSystem);
      Safe(ReadForeground);
      Safe(ReadClipboard);
      if (tick % 2 == 0) Safe(ReadFullscreen);
#if !NO_MEDIA
      if (tick % 4 == 0) Safe(ReadMedia);
      if (mgr == null && tick % 40 == 39) Safe(InitMedia);
#endif
      if (netOn && tick % 8 == 0) Safe(ReadNet);
#if UIA
      if (amWatch && tick % 2 == 0) Safe(ReadAppleMusic);
#endif
      if (toastsOn && tick % 6 == 0) Safe(ReadToasts);
      if (tick % 120 == 0) Emit(D("type", "mem", "ws", Process.GetCurrentProcess().WorkingSet64));
      // Let the runtime collect naturally; forced working-set eviction caused hover stalls.
      tick++;
      Thread.Sleep(250);
    }
    return 0;
  }

  // ---------------- media
#if !NO_MEDIA
  static void InitMedia() {
    try { mgr = Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync(), 5000); }
    catch (Exception e) { mgr = null; Emit(D("type", "error", "where", "media-init", "msg", e.Message)); }
  }

  static GlobalSystemMediaTransportControlsSession Session() {
    if (mgr == null) return null;
    foreach (GlobalSystemMediaTransportControlsSession s in mgr.GetSessions()) {
      if (s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing) return s;
    }
    return mgr.GetCurrentSession();
  }

  static string lastKey = "";
  static bool artOk = false;
  static int artTries = 0;
  static void ReadMedia() {
    GlobalSystemMediaTransportControlsSession s = Session();
    if (s == null) { Emit(D("type", "media", "active", false)); lastKey = ""; return; }
    GlobalSystemMediaTransportControlsSessionMediaProperties p = Wait(s.TryGetMediaPropertiesAsync(), 3000);
    GlobalSystemMediaTransportControlsSessionPlaybackInfo pb = s.GetPlaybackInfo();
    GlobalSystemMediaTransportControlsSessionTimelineProperties tl = s.GetTimelineProperties();
    bool playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    double dur = (tl.EndTime - tl.StartTime).TotalSeconds;
    double pos = tl.Position.TotalSeconds;
    if (playing && tl.LastUpdatedTime.Year > 2000) pos += (DateTimeOffset.Now - tl.LastUpdatedTime).TotalSeconds;
    if (dur > 0 && pos > dur) pos = dur;
    if (pos < 0) pos = 0;
    string title = p != null && p.Title != null ? p.Title : "";
    string artist = p != null && p.Artist != null ? p.Artist : "";
    string album = p != null && p.AlbumTitle != null ? p.AlbumTitle : "";
    string albumArtist = p != null && p.AlbumArtist != null ? p.AlbumArtist : ""; // Apple Music sometimes puts "Artist — Album" here
    string app = s.SourceAppUserModelId ?? "";
    string key = title + "|" + artist + "|" + app;
    bool canSeek = pb.Controls != null && pb.Controls.IsPlaybackPositionEnabled;
    Emit(D("type", "media", "active", title.Length > 0, "title", title, "artist", artist, "album", album, "albumArtist", albumArtist,
      "playing", playing, "position", Math.Round(pos, 2), "duration", Math.Round(dur, 2), "app", app, "key", key, "canSeek", canSeek));
    // Spotify & co. often publish the cover a moment after the title: keep asking for ~12 s
    if (key != lastKey) { lastKey = key; artOk = false; artTries = 0; }
    if (!artOk && artTries < 12) { artTries++; artOk = SendArt(p, key, artTries == 1); }
  }

  static bool SendArt(GlobalSystemMediaTransportControlsSessionMediaProperties p, string key, bool always) {
    string data = null;
    try {
      if (p != null && p.Thumbnail != null) {
        using (Windows.Storage.Streams.IRandomAccessStreamWithContentType st = Wait(p.Thumbnail.OpenReadAsync(), 3000)) {
          if (st != null && st.Size > 0 && st.Size < 4 * 1024 * 1024) {
            // Dispose both WinRT objects after reading each cover.
            using (Windows.Storage.Streams.DataReader r = new Windows.Storage.Streams.DataReader(st.GetInputStreamAt(0))) {
              uint n = Wait<uint>(r.LoadAsync((uint)st.Size), 3000);
              if (n > 0) {
                byte[] buf = new byte[n];
                r.ReadBytes(buf);
                string ct = String.IsNullOrEmpty(st.ContentType) ? "image/png" : st.ContentType;
                data = "data:" + ct + ";base64," + Convert.ToBase64String(buf);
              }
            }
          }
        }
      }
    } catch (Exception e) { Emit(D("type", "diag", "where", "album-art", "msg", e.Message)); }
    if (data != null || always) Emit(D("type", "art", "key", key, "data", data));
    return data != null;
  }
#endif

#if UIA
  // Apple Music's real position, from its own progress slider (twice a second, only while asked)
  static void ReadAppleMusic() {
    double v, min, max;
    bool ok = AppleUia.Read(out v, out min, out max);
#if !NO_MEDIA
    string key = lastKey;
#else
    string key = amTrack;
#endif
    Emit(D("type", "ampos", "key", key, "ok", ok, "pos", v, "min", min, "max", max));
  }
#endif

  // ---------------- commands from Atoll
  static bool Truthy(Dictionary<string, object> o, string k) { object v; return o.TryGetValue(k, out v) && v is bool && (bool)v; }

  static void Command(string line) {
    Dictionary<string, object> o = J.Deserialize<Dictionary<string, object>>(line);
    object v;
    string cmd = o.TryGetValue("cmd", out v) ? Convert.ToString(v) : "";
    if (cmd == "net") { netOn = Truthy(o, "on"); return; }
#if UIA
    if (cmd == "amwatch") {
      string key = o.TryGetValue("key", out v) ? Convert.ToString(v) : "";
      if (key != amTrack) { amTrack = key; AppleUia.Reset(); }
      amWatch = Truthy(o, "on"); if (amWatch) ReadAppleMusic(); return;
    }
    if (cmd == "amseek") { double to = o.TryGetValue("pos", out v) ? Convert.ToDouble(v) : 0; bool okSeek = AppleUia.Seek(to); Emit(D("type", "amdone", "cmd", "seek", "ok", okSeek)); Thread.Sleep(120); ReadAppleMusic(); return; }
    if (cmd == "amprev") { bool okBack = AppleUia.Back(); Emit(D("type", "amdone", "cmd", "prev", "ok", okBack)); return; }
#else
    if (cmd == "amwatch" || cmd == "amseek" || cmd == "amprev") { Emit(D("type", "amdone", "cmd", cmd, "ok", false, "why", "not built with UI Automation")); return; }
#endif
    if (cmd == "toasts") { toastsOn = Truthy(o, "on"); return; }
    if (cmd == "paste") { Thread.Sleep(60); Paste(); return; }
    if (cmd == "capture") { Capture(o); return; }
    if (cmd == "trim") {
      object pl;
      System.Collections.IEnumerable list = o.TryGetValue("pids", out pl) && !(pl is string) ? pl as System.Collections.IEnumerable : null; // ArrayList or object[]
      if (list != null) foreach (object x in list) { try { Win.Trim(Convert.ToInt32(x)); } catch { } }
      GC.Collect(); Win.SetProcessWorkingSetSize(Process.GetCurrentProcess().Handle, (IntPtr)(-1), (IntPtr)(-1));
      Emit(D("type", "mem", "ws", Process.GetCurrentProcess().WorkingSet64));
      return;
    }
    if (cmd == "setvol") { try { Audio.SetVolume(Convert.ToInt32(o.TryGetValue("v", out v) ? v : 0)); } catch { Audio.Reset(); } return; }
#if !NO_MEDIA
    GlobalSystemMediaTransportControlsSession s = Session();
    if (s == null) return;
    if (cmd == "toggle") Wait(s.TryTogglePlayPauseAsync(), 2000);
    else if (cmd == "next") Wait(s.TrySkipNextAsync(), 2000);
    else if (cmd == "prev") Wait(s.TrySkipPreviousAsync(), 2000);
    else if (cmd == "seek") {
      double pos = o.TryGetValue("pos", out v) ? Convert.ToDouble(v) : 0;
      Wait(s.TryChangePlaybackPositionAsync((long)(pos * 10000000)), 2000);
    } else return;
    Thread.Sleep(150);
    ReadMedia();
#endif
  }

  // Screenshot in real pixels with GDI (works even when Chromium's capture doesn't)
  static void Capture(Dictionary<string, object> o) {
    object v;
    string id = o.TryGetValue("id", out v) ? Convert.ToString(v) : "";
    string file = o.TryGetValue("file", out v) ? Convert.ToString(v) : "";
    try {
      int x = Convert.ToInt32(o["x"]), y = Convert.ToInt32(o["y"]), w = Convert.ToInt32(o["w"]), h = Convert.ToInt32(o["h"]);
      using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
      using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bmp)) {
        g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h), System.Drawing.CopyPixelOperation.SourceCopy);
        bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png);
      }
      Emit(D("type", "captured", "id", id, "file", file, "ok", true));
    } catch (Exception e) {
      Emit(D("type", "captured", "id", id, "ok", false, "error", e.Message));
    }
  }

  static void Paste() {
    Win.keybd_event(0x12, 0, 2, UIntPtr.Zero); Win.keybd_event(0x10, 0, 2, UIntPtr.Zero); // Alt/Shift up
    Win.keybd_event(0x11, 0, 0, UIntPtr.Zero); Win.keybd_event(0x56, 0, 0, UIntPtr.Zero);
    Win.keybd_event(0x56, 0, 2, UIntPtr.Zero); Win.keybd_event(0x11, 0, 2, UIntPtr.Zero);
  }

  // ---------------- system state
  static int lv = -2; static bool lm, lcaps; static string llang = null, ldev = null; static string ldevName = "";
  static readonly object SysLock = new object();
  // called on Windows' audio thread by VolumeWatch
  public static void OnVolume(int vol, bool muted) {
    lock (SysLock) {
      if (vol == lv && muted == lm) return;
      lv = vol; lm = muted;
      Emit(D("type", "system", "volume", vol, "muted", muted, "caps", lcaps, "lang", llang ?? "", "device", ldevName, "deviceId", ldev ?? ""));
    }
  }
  static void ReadSystem() {
    int vol = -1; bool muted = false; string devName = "", devId = "";
    try { vol = Audio.Volume(); muted = Audio.Muted(); devId = Audio.DevId; devName = Audio.DevName; } catch { Audio.Reset(); }
    bool caps = (Win.GetKeyState(0x14) & 1) != 0;
    string lang = KeyboardLang();
    lock (SysLock) {
      if (vol != lv || muted != lm || caps != lcaps || lang != llang || devId != ldev) {
        lv = vol; lm = muted; lcaps = caps; llang = lang; ldev = devId; ldevName = devName;
        Emit(D("type", "system", "volume", vol, "muted", muted, "caps", caps, "lang", lang, "device", devName, "deviceId", devId));
      }
    }
  }

  static string KeyboardLang() {
    try {
      uint pid;
      uint t = Win.GetWindowThreadProcessId(Win.GetForegroundWindow(), out pid);
      int lang = (int)((long)Win.GetKeyboardLayout(t) & 0xFFFF);
      return new System.Globalization.CultureInfo(lang).TwoLetterISOLanguageName.ToUpperInvariant();
    } catch { return ""; }
  }

  static IntPtr fgHwnd = IntPtr.Zero; static string fgProc = null;
  static void ReadForeground() {
    IntPtr h = Win.GetForegroundWindow();
    if (h == fgHwnd && fgProc != null) return;
    fgHwnd = h;
    string name = "";
    uint pid;
    Win.GetWindowThreadProcessId(h, out pid);
    try { using (Process pr = Process.GetProcessById((int)pid)) name = pr.ProcessName; } catch { }
    if (name != fgProc) { fgProc = name; Emit(D("type", "fg", "proc", name)); }
  }

  // The clipboard changed: read its text here too (an STA thread, a moment later, with retries) and
  // send it along, so Atoll has the copy even when its own read finds the clipboard locked or fails.
  // Copies marked private by password managers are reported as private, without their text.
  static uint clipSeq = 0;
  static void ReadClipboard() {
    uint n = Win.GetClipboardSequenceNumber();
    if (n == clipSeq) return;
    bool first = clipSeq == 0;
    clipSeq = n;
    if (first) return;
    uint seq = n;
    Thread t = new Thread(() => {
      string text = null, err = null; bool priv = false, hasText = false;
      for (int i = 0; i < 4; i++) {
        Thread.Sleep(i == 0 ? 80 : 150 * i);
        try {
          priv = Win.IsClipboardFormatAvailable(Win.RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"));
          if (priv) { err = null; break; }
          hasText = System.Windows.Forms.Clipboard.ContainsText();
          if (hasText) text = System.Windows.Forms.Clipboard.GetText();
          err = null; break;
        } catch (Exception e) { err = e.Message; }
      }
      if (text != null && text.Length > 20000) text = text.Substring(0, 20000);
      Emit(D("type", "clip", "seq", (long)seq, "text", text, "private", priv, "error", err));
    });
    t.SetApartmentState(ApartmentState.STA);
    t.IsBackground = true;
    t.Start();
  }

  static int fs = -1;
  static void ReadFullscreen() {
    bool on = false;
    IntPtr h = Win.GetForegroundWindow();
    if (h != IntPtr.Zero) {
      StringBuilder sb = new StringBuilder(256);
      Win.GetClassName(h, sb, 256);
      string c = sb.ToString();
      Win.RECT r;
      if (c != "Progman" && c != "WorkerW" && c != "Shell_TrayWnd" && Win.GetWindowRect(h, out r)) {
        System.Drawing.Rectangle s = System.Windows.Forms.Screen.FromHandle(h).Bounds;
        on = r.Left <= s.Left && r.Top <= s.Top && r.Right >= s.Right && r.Bottom >= s.Bottom;
      }
    }
    int v = on ? 1 : 0;
    if (v != fs) { fs = v; Emit(D("type", "fullscreen", "on", on)); }
  }

  static void ReadNet() {
    long rx = 0, tx = 0;
    foreach (System.Net.NetworkInformation.NetworkInterface n in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()) {
      if (n.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
      if (n.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback || n.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
      try { System.Net.NetworkInformation.IPInterfaceStatistics st = n.GetIPStatistics(); rx += st.BytesReceived; tx += st.BytesSent; } catch { }
    }
    Emit(D("type", "net", "rx", rx, "tx", tx, "t", (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds));
  }

  static string toastErr = null;
  static void ReadToasts() {
    List<string[]> rows = Toasts.Poll();
    if (Toasts.Error != toastErr) {
      toastErr = Toasts.Error;
      Emit(D("type", "toasts-status", "ok", toastErr.Length == 0, "error", toastErr));
    }
    foreach (string[] r in rows) {
      string[] t = Toasts.Texts(r[2]);
      if (t[0].Length > 0 || t[1].Length > 0) Emit(D("type", "toast", "id", r[0], "app", r[1], "title", t[0], "body", t[1], "attribution", t[2]));
    }
  }
}
