' Windows sign-in: restarts the processes saved with `pm2 save`, without a console window.
' Registered in HKCU\Software\Microsoft\Windows\CurrentVersion\Run as DealHunter.
Set sh = CreateObject("WScript.Shell")
sh.Run """" & sh.ExpandEnvironmentStrings("%APPDATA%") & "\npm\pm2.cmd"" resurrect", 0, False
