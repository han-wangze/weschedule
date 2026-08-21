@echo off
REM 一键运行 eval：自动读取项目根 .env 注入 DEEPSEEK_API_KEY 后执行 run_eval.py
REM 用法：双击或 cmd 中 eval\run_dev.bat [参数]  例如：eval\run_dev.bat --dataset dev
setlocal
set "ROOT=%~dp0.."
if exist "%ROOT%\.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%i in ("%ROOT%\.env") do (
    if not "%%i"=="" set "%%i=%%j"
  )
)
cd /d "%ROOT%"
if defined PYTHON (python eval\run_eval.py %*) else (python eval\run_eval.py %*)
endlocal
