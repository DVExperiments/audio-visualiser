using System.Text;
using System.Text.Json;
using AudioViz.Capture;

// AudioCapture: stdin = NDJSON commands, stdout = NDJSON messages, stderr = diagnostics.
// The process exits when stdin closes (i.e. when Electron exits or kills the pipe).

Console.InputEncoding = Encoding.UTF8;
var stdout = Console.OpenStandardOutput();
var writer = new ProtocolWriter(stdout);
writer.SendControl(w =>
{
    w.WriteString("type", "hello");
    w.WriteNumber("protocol", ProtocolWriter.ProtocolVersion);
    w.WriteString("version", typeof(Controller).Assembly.GetName().Version?.ToString(3) ?? "0.1.0");
    w.WriteNumber("t", Clock.NowMs);
    w.WriteNumber("unixAtStartMs", Clock.UnixAtStartMs);
    w.WriteString("runtime", Environment.Version.ToString());
});

var controller = new Controller(writer);
controller.Handle(JsonDocument.Parse("{\"cmd\":\"listDevices\"}").RootElement);

using var stdin = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
string? line;
while ((line = stdin.ReadLine()) != null)
{
    if (line.Length == 0) continue;
    if (line.Length > 4096) { ProtocolWriter.Error(writer, "badCommand", "Command too long."); continue; }
    try
    {
        using var doc = JsonDocument.Parse(line);
        if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("Command must be a JSON object.");
        if (doc.RootElement.TryGetProperty("cmd", out var c) && c.GetString() == "shutdown") break;
        controller.Handle(doc.RootElement.Clone());
    }
    catch (JsonException e) { ProtocolWriter.Error(writer, "badCommand", e.Message); }
}

controller.Dispose();
writer.Dispose();
return 0;
