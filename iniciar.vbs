Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd /d ""C:\Users\User\OneDrive\Documentos\Faculdade\Projetos\GestaoPDV_1.1.2\loja-sistema"" && npm start", 0, False
WScript.Sleep 3000
WshShell.Run "http://localhost:3000/login.html"