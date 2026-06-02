@echo off
cd /d d:\SillyTavern\ne-memory
call npm run build > build_result.txt 2>&1
echo BUILD_EXIT:%ERRORLEVEL% >> build_result.txt
call git add -A >> build_result.txt 2>&1
call git commit -m "refactor: extract isRetrievalEnabled/setRetrievalEnabled to settings.js to break circular dependencies" >> build_result.txt 2>&1
echo COMMIT_EXIT:%ERRORLEVEL% >> build_result.txt
call git push origin main >> build_result.txt 2>&1
echo PUSH_EXIT:%ERRORLEVEL% >> build_result.txt
call git rev-parse --short HEAD >> build_result.txt 2>&1
