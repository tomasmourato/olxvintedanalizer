' Windows sign-in: restarts the processes saved with `pm2 save`, without a console window.
' Registered in HKCU\Software\Microsoft\Windows\CurrentVersion\Run as DealHunter.
' Waits a little after sign-in, retries, and logs every attempt to %USERPROFILE%\.pm2\autostart.log:
' on 2026-09-24 the worker did not come back after a sign-in and nothing showed why.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
pm2 = """" & sh.ExpandEnvironmentStrings("%APPDATA%") & "\npm\pm2.cmd"""
logFile = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.pm2\autostart.log"

Sub LogLine(text)
  On Error Resume Next
  Set f = fs.OpenTextFile(logFile, 8, True)
  f.WriteLine Now & "  " & text
  f.Close
End Sub

LogLine "autostart: signed in"
WScript.Sleep 20000
For attempt = 1 To 5
  code = sh.Run(pm2 & " resurrect", 0, True)
  LogLine "pm2 resurrect, attempt " & attempt & ": exit " & code
  If code = 0 Then WScript.Quit 0
  WScript.Sleep 30000
Next
LogLine "autostart: gave up"
