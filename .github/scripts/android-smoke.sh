#!/bin/sh
# Smoke test do spike Android.
#
# Roda dentro do emulador do CI: instala o APK, abre o app, valida que o
# processo continua vivo, que o servidor local responde em /api/health e que
# o WebView renderizou a página. Gera screenshot e logcat como artefatos.
set -eu

APK="apps/android/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.minhabolha.android"
PORT="47821"

echo "== Instalando APK =="
adb install -r "$APK"

echo "== Abrindo o app =="
adb shell am start -W -n "$PACKAGE/.MainActivity"

sleep 12

echo "== Capturando screenshot e logcat =="
adb exec-out screencap -p > android-spike.png || true
adb logcat -d > android-logcat.txt || true

echo "== Verificando processos e crashes =="
PID="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
if [ -z "$PID" ]; then
  echo "ERRO: processo do app não está rodando"
  exit 1
fi
if adb logcat -d -s AndroidRuntime:E | grep -q "FATAL EXCEPTION"; then
  echo "ERRO: exceção fatal no app"
  adb logcat -d -s AndroidRuntime:E
  exit 1
fi
echo "PID: $PID"

echo "== Verificando /api/health pelo servidor local =="
adb forward "tcp:$PORT" "tcp:$PORT"
HEALTH="$(curl -fsS --max-time 15 "http://127.0.0.1:$PORT/api/health" || true)"
echo "$HEALTH"
if [ -z "$HEALTH" ]; then
  echo "ERRO: servidor local não respondeu em /api/health"
  exit 1
fi
case "$HEALTH" in
  *'"ok":true'*) echo "health ok" ;;
  *)
    echo "ERRO: resposta inesperada de /api/health"
    exit 1
    ;;
esac
case "$HEALTH" in
  *'sqlite-ok'*) echo "sqlite ok" ;;
  *)
    echo "ERRO: SQLite não respondeu como esperado"
    exit 1
    ;;
esac

echo "== Verificando a página servida pelo app =="
PAGE="$(curl -fsS --max-time 15 "http://127.0.0.1:$PORT/" || true)"
case "$PAGE" in
  *'Minha Bolha Android'*) echo "WebView HTML ok" ;;
  *)
    echo "ERRO: HTML do app não foi servido"
    exit 1
    ;;
esac

echo "== Verificando logcat do WebView =="
if adb logcat -d -s chromium:E | grep -q "ERR_"; then
  echo "ERRO: WebView reportou falha de rede"
  adb logcat -d -s chromium:E
  exit 1
fi

echo "Smoke test Android OK"
