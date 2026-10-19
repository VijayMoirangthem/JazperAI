// Tiny no-console launcher: runs scripts\jasper-launch.ps1 hidden. Built into "Jazper.exe" by scripts\build_launcher.ps1.
using System;
using System.Diagnostics;
using System.IO;

static class Launcher
{
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(dir, "scripts", "jasper-launch.ps1");
        if (!File.Exists(script)) return;
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"")
        {
            WorkingDirectory = dir,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        Process.Start(psi);
    }
}
