// Native Messaging only. No HTTP port, remote job polling, or general command runner.
// BuildInfo.cs is generated alongside this file with the pinned extension ID and web origin.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal static class Host {
    private static readonly string Local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    private static readonly string Home = Path.Combine(Local, "LanhDiaYouTube", "ChromeHub");
    private static readonly string StatePath = Path.Combine(Home, "hub.json");
    private static readonly string ChromeRoot = Path.Combine(Local, "Google", "Chrome", "User Data");
    private const string Marker = "LanhDiaYouTube.ChromeHub.link";
    private const int FrameLimit = 8192;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 2097152, RecursionLimit = 15 };
    private static readonly Regex Key = Rx(@"\A[a-f0-9]{32}\z");
    private static readonly Regex Channel = Rx(@"\AUC[A-Za-z0-9_-]{22}\z");
    private static readonly Regex Workspace = Rx(@"\A[A-Za-z0-9_-]{1,128}\z");
    private static readonly Regex DirectoryName = Rx(@"\A(?:Default|Profile [1-9][0-9]{0,3})\z");
    private static Regex Rx(string pattern) { return new Regex(pattern, RegexOptions.CultureInvariant); }
    private static string NativeKey { get { return @"Software\Google\Chrome\NativeMessagingHosts\" + BuildInfo.HostName; } }
    private static string ExtensionOrigin { get { return "chrome-extension://" + BuildInfo.ExtensionId + "/"; } }
    private static long Now { get { return DateTime.UtcNow.Ticks / TimeSpan.TicksPerSecond; } }
    private static string Id() { return Guid.NewGuid().ToString("N"); }

    public class HubStore {
        public Dictionary<string, string> Profiles { get; set; }
        public Dictionary<string, string> Links { get; set; }
        public List<Pair> Pairs { get; set; }
        public List<Job> Jobs { get; set; }
        public string DashboardProfile { get; set; }
        public string DashboardWorkspace { get; set; }
        public HubStore() { Profiles = new Dictionary<string, string>(); Links = new Dictionary<string, string>(); Pairs = new List<Pair>(); Jobs = new List<Job>(); }
    }
    public class Pair {
        public string Ticket { get; set; }
        public string Source { get; set; }
        public string Directory { get; set; }
        public long Until { get; set; }
    }
    public class Job {
        public string Ticket { get; set; }
        public string Source { get; set; }
        public string Workspace { get; set; }
        public string Channel { get; set; }
        public long Until { get; set; }
    }

    private static string Text(IDictionary<string, object> req, string field) {
        object value;
        return req.TryGetValue(field, out value) ? (value as string ?? "") : "";
    }
    private static object Ok(object data) { return new { ok = true, data = data }; }
    private static object Fail(string code) { return new { ok = false, code = code }; }
    private static bool Regular(string path) {
        try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0; } catch (IOException) { return false; }
    }
    private static string ProfilePath(string directory) {
        if (string.IsNullOrEmpty(directory) || !DirectoryName.IsMatch(directory) || !Directory.Exists(ChromeRoot) || !Regular(ChromeRoot) ||
            !Regular(Path.GetDirectoryName(ChromeRoot)) || !Regular(Path.GetDirectoryName(Path.GetDirectoryName(ChromeRoot)))) return null;
        var full = Path.Combine(ChromeRoot, directory);
        return Directory.Exists(full) && Regular(full) ? full : null;
    }
    private static string Verified(HubStore db, string source) {
        string directory;
        if (source == null || !db.Profiles.TryGetValue(source, out directory)) return "";
        var full = ProfilePath(directory);
        if (full == null) return "";
        var stamp = Path.Combine(full, Marker);
        if (!File.Exists(stamp) || !Regular(stamp) || new FileInfo(stamp).Length != 32) return "";
        return File.ReadAllText(stamp, Utf8) == source ? directory : "";
    }
    private static void Atomic(string path, string text) {
        var temp = path + "." + Id() + ".tmp";
        try {
            File.WriteAllText(temp, text, Utf8);
            if (File.Exists(path)) File.Replace(temp, path, null);
            else File.Move(temp, path);
        } finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static HubStore ReadStore() {
        if (!File.Exists(StatePath)) return new HubStore();
        if (!Regular(StatePath) || new FileInfo(StatePath).Length > 2097152) throw new IOException("Store");
        var data = Json.Deserialize<HubStore>(File.ReadAllText(StatePath, Utf8));
        data.Pairs.RemoveAll(p => p.Until <= Now);
        data.Jobs.RemoveAll(j => j.Until <= Now);
        return data;
    }
    private static void Save(HubStore db) {
        Directory.CreateDirectory(Home);
        Atomic(StatePath, Json.Serialize(db));
    }
    private static string FindChrome() {
        // Only edition Stable in standard Windows install locations. No PATH or custom command.
        foreach (var parent in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Local }) {
            if (string.IsNullOrEmpty(parent) || !Path.IsPathRooted(parent)) continue;
            var exe = Path.Combine(parent, "Google", "Chrome", "Application", "chrome.exe");
            if (File.Exists(exe) && Regular(exe)) return exe;
        }
        return null;
    }
    private static bool Open(string directory, string approvedUrl) {
        if (ProfilePath(directory) == null) return false;
        var chrome = FindChrome();
        if (chrome == null) return false;
        try {
            // directory and the URL are constructed solely from validated identifiers and fixed routes.
            var started = Process.Start(new ProcessStartInfo(chrome) {
                UseShellExecute = false, Arguments = "--profile-directory=\"" + directory + "\" --new-tab \"" + approvedUrl + "\"",
                WorkingDirectory = Path.GetDirectoryName(chrome)
            });
            if (started == null) return false;
            started.Dispose(); return true; // launch requested, not a claim about Studio sign-in
        } catch (System.ComponentModel.Win32Exception) { return false; }
    }
    private static string Target(string channel, string view) {
        var studio = "https://studio.youtube.com/channel/" + channel;
        switch (view) {
            case "studio": return studio;
            case "channel": return "https://www.youtube.com/channel/" + channel;
            case "content": return studio + "/videos/upload";
            case "analytics": return studio + "/analytics/tab-overview/period-default";
            default: return null;
        }
    }

    private static object Handle(IDictionary<string, object> req) {
        string source = Text(req, "source"), op = Text(req, "op"), workspace = Text(req, "workspace");
        if (!Key.IsMatch(source)) return Fail("INVALID_REQUEST");
        var db = ReadStore();
        var profile = Verified(db, source);
        if (op == "local") {
            var dirs = Directory.Exists(ChromeRoot) ? Directory.GetDirectories(ChromeRoot)
                .Select(Path.GetFileName).Where(d => ProfilePath(d) != null).OrderBy(n => n).Take(1000).ToArray() : new string[0];
            return Ok(new { profile = profile, directories = dirs, dashboard = !string.IsNullOrEmpty(Verified(db, db.DashboardProfile)) });
        }
        if (op == "state") {
            if (!Workspace.IsMatch(workspace)) return Fail("INVALID_REQUEST");
            bool configured = Verified(db, db.DashboardProfile) != "";
            var dashboard = !configured ? "unset" : db.DashboardWorkspace != workspace ? "different-workspace" : db.DashboardProfile == source ? "this" : "other";
            return Ok(new { profile = profile, dashboard = dashboard, pending = dashboard == "this" ? db.Jobs.Count : 0 });
        }
        string ticket = Text(req, "ticket");
        if (op == "pair-start") {
            string directory = Text(req, "directory");
            if (ProfilePath(directory) == null) return Fail("PROFILE_NOT_FOUND");
            if (profile != "" && profile != directory) return Fail("ALREADY_PAIRED");
            db.Pairs.RemoveAll(p => p.Source == source);
            if (db.Pairs.Count >= 20) return Fail("BUSY");
            var pair = new Pair { Source = source, Directory = directory, Ticket = Id(), Until = Now + 120 };
            db.Pairs.Add(pair); Save(db);
            if (!Open(directory, BuildInfo.Origin + "/chrome-verify#pair=" + pair.Ticket)) {
                db.Pairs.Remove(pair); Save(db); return Fail("CHROME_LAUNCH_FAILED");
            }
            return Ok(new { started = true });
        }
        if (op == "pair-finish") {
            var pair = Key.IsMatch(ticket) ? db.Pairs.FirstOrDefault(p => p.Ticket == ticket) : null;
            if (pair == null) return Fail("PAIR_EXPIRED");
            if (pair.Source != source) return Fail("PAIR_WRONG_PROFILE");
            var path = ProfilePath(pair.Directory);
            if (path == null) return Fail("PROFILE_NOT_FOUND");
            var stamp = Path.Combine(path, Marker);
            if (File.Exists(stamp) && !Regular(stamp)) return Fail("PROFILE_NOT_FOUND");
            Atomic(stamp, source);
            foreach (var gone in db.Profiles.Where(p => p.Value == pair.Directory && p.Key != source).Select(p => p.Key).ToArray()) db.Profiles.Remove(gone);
            db.Profiles[source] = pair.Directory; db.Pairs.Remove(pair); Save(db);
            return Ok(new { profile = pair.Directory });
        }
        if (profile == "") return Fail("PROFILE_UNPAIRED");
        if (op == "dashboard") {
            if (!Workspace.IsMatch(workspace)) return Fail("INVALID_REQUEST");
            if (db.DashboardWorkspace != workspace) db.Jobs.Clear();
            db.DashboardWorkspace = workspace; db.DashboardProfile = source; Save(db);
            return Ok(new { profile = profile, dashboard = "this", pending = db.Jobs.Count });
        }
        if (op == "capture") {
            var channel = Text(req, "channelId");
            if (!Channel.IsMatch(channel)) return Fail("INVALID_REQUEST");
            var dir = Verified(db, db.DashboardProfile);
            if (dir == "" || !Workspace.IsMatch(db.DashboardWorkspace ?? "")) return Fail("NO_DASHBOARD");
            var prior = db.Jobs.FirstOrDefault(j => j.Source == source && j.Workspace == db.DashboardWorkspace && j.Channel == channel);
            if (prior == null && db.Jobs.Count >= 64) return Fail("QUEUE_FULL");
            var job = prior ?? new Job { Ticket = Id(), Source = source, Workspace = db.DashboardWorkspace, Channel = channel };
            job.Until = Now + 1800;
            if (prior == null) db.Jobs.Add(job);
            Save(db);
            bool sent = Open(dir, BuildInfo.Origin + "/channels#chrome-sync=" + job.Ticket);
            return sent ? Ok(new { sent = true }) : Fail("CAPTURE_QUEUED");
        }
        // Every read/ack/launch below requires the locally configured dashboard profile AND workspace.
        if (!Workspace.IsMatch(workspace) || db.DashboardProfile != source || db.DashboardWorkspace != workspace) return Fail("WRONG_DASHBOARD");
        if (op == "jobs") return Ok(db.Jobs.Where(j => j.Workspace == workspace).Select(j => j.Ticket).ToArray());
        if (op == "read" || op == "ack") {
            var job = Key.IsMatch(ticket) ? db.Jobs.FirstOrDefault(j => j.Ticket == ticket && j.Workspace == workspace) : null;
            if (job == null) return Fail("CAPTURE_EXPIRED");
            var directory = Verified(db, job.Source);
            if (directory == "") return Fail("PROFILE_NOT_FOUND");
            if (op == "read") return Ok(new { ticket = job.Ticket, channelId = job.Channel, profileKey = job.Source, directory = directory, workspace = workspace });
            db.Links[workspace + "/" + job.Channel] = job.Source;
            db.Jobs.Remove(job); Save(db);
            return Ok(new { linked = true });
        }
        if (op == "open" || op == "unlink") {
            var channel = Text(req, "channelId"); var expected = Text(req, "profileKey");
            if (!Channel.IsMatch(channel) || !Key.IsMatch(expected)) return Fail("INVALID_REQUEST");
            var key = workspace + "/" + channel;
            string bound;
            if (!db.Links.TryGetValue(key, out bound) || expected != bound) return Fail("CHANNEL_NOT_LINKED_HERE");
            if (op == "unlink") { db.Links.Remove(key); Save(db); return Ok(new { removed = true }); }
            var directory = Verified(db, bound);
            if (directory == "") return Fail("PROFILE_NOT_FOUND");
            var url = Target(channel, Text(req, "view"));
            if (url == null) return Fail("INVALID_REQUEST");
            return Open(directory, url) ? Ok(new { profile = directory }) : Fail("CHROME_LAUNCH_FAILED");
        }
        return Fail("INVALID_REQUEST");
    }

    private static byte[] ReadExactly(Stream input, int length) {
        var buffer = new byte[length];
        for (int at = 0; at < length;) {
            int got = input.Read(buffer, at, length - at);
            if (got <= 0) throw new EndOfStreamException();
            at += got;
        }
        return buffer;
    }
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--install") {
            try {
                Directory.CreateDirectory(Home);
                var manifest = Path.Combine(Home, "native-messaging.json");
                Atomic(manifest, Json.Serialize(new { name = BuildInfo.HostName, description = "Lanh Dia YouTube Chrome Hub", path = typeof(Host).Assembly.Location, type = "stdio", allowed_origins = new[] { ExtensionOrigin } }));
                using (var key = Registry.CurrentUser.CreateSubKey(NativeKey)) { key.SetValue("", manifest); }
                return 0;
            } catch (Exception) { return 1; }
        }
        if (args.Length == 1 && args[0] == "--uninstall") {
            try {
                Registry.CurrentUser.DeleteSubKeyTree(NativeKey, false);
                if (File.Exists(StatePath)) File.Delete(StatePath);
                return 0;
            } catch (Exception) { return 1; }
        }
        if (args.Length == 0 || args[0] != ExtensionOrigin) return 2;
        var input = Console.OpenStandardInput();
        var output = Console.OpenStandardOutput();
        try {
            var size = BitConverter.ToInt32(ReadExactly(input, 4), 0);
            if (size < 2 || size > FrameLimit) return 3;
            var request = Json.Deserialize<Dictionary<string, object>>(Utf8.GetString(ReadExactly(input, size)));
            object reply;
            using (var mutex = new Mutex(false, @"Local\LanhDiaYouTubeChromeHub")) {
                bool locked; try { locked = mutex.WaitOne(4000); } catch (AbandonedMutexException) { locked = true; }
                try { reply = locked && request != null ? Handle(request) : Fail("BUSY"); }
                catch (Exception) { reply = Fail("HELPER_ERROR"); }
                finally { if (locked) mutex.ReleaseMutex(); }
            }
            var body = Utf8.GetBytes(Json.Serialize(reply));
            output.Write(BitConverter.GetBytes(body.Length), 0, 4); output.Write(body, 0, body.Length); output.Flush();
            return 0;
        } catch (Exception) { return 3; }
    }
}
