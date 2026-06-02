Set-Location d:\SillyTavern\ne-memory
npm run build 2>&1 | Out-File -FilePath d:\SillyTavern\ne-memory\build-log.txt -Encoding utf8
git add -A 2>&1 | Out-File -FilePath d:\SillyTavern\ne-memory\build-log.txt -Append -Encoding utf8
git commit -m "fix: wrap consolidation button handler in try/catch" 2>&1 | Out-File -FilePath d:\SillyTavern\ne-memory\build-log.txt -Append -Encoding utf8
git push origin main 2>&1 | Out-File -FilePath d:\SillyTavern\ne-memory\build-log.txt -Append -Encoding utf8
$hash = git rev-parse --short HEAD
echo "HASH:$hash" | Out-File -FilePath d:\SillyTavern\ne-memory\build-log.txt -Append -Encoding utf8
