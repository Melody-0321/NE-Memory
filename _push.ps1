Set-Location d:\SillyTavern\ne-memory
git push origin main 2>&1 | Out-File -FilePath d:\SillyTavern\ne-memory\_push_log.txt -Encoding utf8
$hash = git rev-parse --short HEAD
$hash | Out-File -FilePath d:\SillyTavern\ne-memory\_push_log.txt -Append -Encoding utf8
