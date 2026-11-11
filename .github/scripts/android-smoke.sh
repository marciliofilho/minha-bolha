#!/bin/sh
# Smoke test do app Android no emulador do CI.
#
# Valida a pilha completa: APK instalado, servidor local em 127.0.0.1, banco
# SQLite com as migrations do desktop, endpoints principais da API e a UI React
# realmente montada dentro do WebView.
set -eu

APK="apps/android/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.minhabolha.android"
PORT="47821"

fail() {
  echo "ERRO: $1"
  echo "== logcat (MinhaBolha / chromium) =="
  adb logcat -d -s MinhaBolha:I chromium:E AndroidRuntime:E || true
  exit 1
}

echo "== Instalando APK =="
adb install -r "$APK"

echo "== Abrindo o app =="
adb shell am start -W -n "$PACKAGE/.MainActivity"

# O app agenda a checagem da UI 6s depois do onPageFinished.
sleep 12

echo "== Capturando screenshot e logcat =="
adb exec-out screencap -p > android-spike.png || true
adb logcat -d > android-logcat.txt || true

echo "== Processo e crash =="
PID="$(adb shell pidof "$PACKAGE" | tr -d '\r')"
[ -n "$PID" ] || fail "processo do app não está rodando"
if adb logcat -d -s AndroidRuntime:E | grep -q "FATAL EXCEPTION"; then
  fail "exceção fatal no app"
fi
echo "PID: $PID"

echo "== API local =="
adb forward "tcp:$PORT" "tcp:$PORT"
BASE="http://127.0.0.1:$PORT"

health="$(curl -fsS --max-time 15 "$BASE/api/health" || true)"
echo "health: $health"
case "$health" in
  *'"ok":true'*) ;;
  *) fail "/api/health não respondeu ok" ;;
esac
case "$health" in
  *'"platform":"android"'*) ;;
  *) fail "/api/health sem platform=android" ;;
esac

categories="$(curl -fsS --max-time 15 "$BASE/api/categories" || true)"
echo "categories: $(printf '%s' "$categories" | cut -c1-160)"
case "$categories" in
  *'"id":"youtube"'*) ;;
  *) fail "categorias do sistema não foram semeadas" ;;
esac

settings="$(curl -fsS --max-time 15 "$BASE/api/settings" || true)"
echo "settings: $(printf '%s' "$settings" | cut -c1-160)"
case "$settings" in
  *'"feedWindowHours"'*) ;;
  *) fail "/api/settings inválido" ;;
esac

feed="$(curl -fsS --max-time 15 "$BASE/api/feed" || true)"
echo "feed: $(printf '%s' "$feed" | cut -c1-160)"
case "$feed" in
  *'"items"'*) ;;
  *) fail "/api/feed inválido" ;;
esac

counts="$(curl -fsS --max-time 15 "$BASE/api/feed/counts" || true)"
case "$counts" in
  *'"counts"'*) ;;
  *) fail "/api/feed/counts inválido" ;;
esac

page="$(curl -fsS --max-time 15 "$BASE/" || true)"
case "$page" in
  *'<div id="root">'*) ;;
  *) fail "HTML do app não foi servido" ;;
esac

# Rota do React Router deve cair no index.html (SPA fallback).
route="$(curl -fsS --max-time 15 "$BASE/settings" || true)"
case "$route" in
  *'<div id="root">'*) ;;
  *) fail "SPA fallback não devolveu o index.html" ;;
esac

echo "== Migrations aplicadas =="
adb shell "run-as $PACKAGE ls databases" | tr -d '\r' || fail "banco não foi criado"
adb shell "run-as $PACKAGE sh -c 'ls databases/hub.db*'" | tr -d '\r' || fail "hub.db ausente"

echo "== UI React montada no WebView =="
READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 10 ]; do
  RAW="$(adb logcat -d -s MinhaBolha:I | grep 'webviewReady' | tail -n 1 || true)"
  VALUE="$(printf '%s' "$RAW" | sed -n 's/.*rootChildren=\([0-9]*\).*/\1/p')"
  VALUE="${VALUE:-0}"
  if [ "$VALUE" -gt 0 ]; then
    READY="$VALUE"
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 3
done
[ "$READY" -gt 0 ] || fail "o React não montou a interface (rootChildren=0)"
echo "rootChildren: $READY"

if adb logcat -d -s MinhaBolha:I | grep -q 'console: Uncaught'; then
  fail "erro JavaScript não tratado no WebView"
fi

echo "Smoke test Android OK"
