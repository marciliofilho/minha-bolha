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

# O Package Manager pode ainda estar finalizando a instalação; abrir o app
# nesse intervalo faz o Android falhar em criar o processo.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if adb shell pm path "$PACKAGE" > /dev/null 2>&1; then break; fi
  sleep 1
done
sleep 3

echo "== Abrindo o app =="
adb shell am start -W -n "$PACKAGE/.MainActivity"

# O app agenda a checagem da UI 6s depois do onPageFinished.
sleep 12

# Se o processo não subiu (corrida na instalação), tenta abrir mais uma vez.
if [ -z "$(adb shell pidof "$PACKAGE" | tr -d '\r')" ]; then
  echo "processo ausente; tentando abrir novamente"
  adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1 || true
  sleep 10
fi

echo "== Capturando screenshot inicial e logcat =="
adb exec-out screencap -p > android-spike.png || true
adb logcat -d > android-logcat-start.txt || true

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

echo "== Resolvendo e criando uma fonte RSS =="
RESOLVE="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"type":"rss","input":"https://hnrss.org/frontpage"}' "$BASE/api/sources/resolve" || true)"
echo "resolve: $(printf '%s' "$RESOLVE" | cut -c1-160)"

NETWORK_OK=1
case "$RESOLVE" in
  *'"config"'*) : ;;
  *) NETWORK_OK=0 ;;
esac

if [ "$NETWORK_OK" -eq 1 ]; then
  # Escuta o SSE antes de criar a fonte para provar que os eventos chegam.
  curl -sN --max-time 30 "$BASE/api/events" > "$PWD/android-events.txt" 2>/dev/null &
  SSE_PID=$!
  sleep 1

  CREATE="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
    -d '{"type":"rss","input":"https://hnrss.org/frontpage","categoryId":"news"}' \
    "$BASE/api/sources" || true)"
  echo "create: $(printf '%s' "$CREATE" | cut -c1-160)"
  SOURCE_ID="$(printf '%s' "$CREATE" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  [ -n "$SOURCE_ID" ] || fail "fonte RSS não foi criada"

  echo "== Aguardando o scheduler sincronizar =="
  INDEX=0
  ITEMS=0
  while [ "$INDEX" -lt 12 ]; do
    FEED2="$(curl -fsS --max-time 15 "$BASE/api/feed" || true)"
    ITEMS="$(printf '%s' "$FEED2" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("items",[])))' 2>/dev/null || echo 0)"
    if [ "$ITEMS" -gt 0 ]; then break; fi
    INDEX=$((INDEX + 1))
    sleep 5
  done

  RUNS="$(curl -fsS --max-time 15 "$BASE/api/sources/$SOURCE_ID/runs" || true)"
  echo "runs: $(printf '%s' "$RUNS" | cut -c1-200)"

  if [ "$ITEMS" -gt 0 ]; then
    echo "feed com $ITEMS item(ns) após sincronizar"
    case "$RUNS" in
      *'"ok":true'*) ;;
      *) fail "fonte sincronizou itens mas o histórico não registrou sucesso" ;;
    esac
  else
    echo "AVISO: nenhum item sincronizado (rede externa indisponível ou feed fora do ar)"
  fi

  wait "$SSE_PID" 2>/dev/null || true
  if grep -q '"type":"source:status"' "$PWD/android-events.txt" 2>/dev/null; then
    echo "SSE entregou source:status"
  else
    echo "AVISO: nenhum evento SSE capturado"
  fi

  # Dá tempo do React Query recarregar o feed via SSE antes do screenshot.
  sleep 8
  adb logcat -d > android-logcat.txt || true
  adb exec-out screencap -p > android-feed.png || true

  EVENT_TS="$(grep 'sse: evento source:status' android-logcat.txt | tail -n 1 | awk '{print $2}')"
  FEED_TS="$(grep 'MinhaBolha: req GET /api/feed' android-logcat.txt | tail -n 1 | awk '{print $2}')"
  if [ -n "$EVENT_TS" ] && [ -n "$FEED_TS" ]; then
    if [ "$FEED_TS" \> "$EVENT_TS" ]; then
      echo "UI recarregou o feed depois do evento SSE ($EVENT_TS -> $FEED_TS)"
    else
      echo "AVISO: nenhuma recarga do feed após o evento SSE ($EVENT_TS / $FEED_TS)"
    fi
  fi

  echo "== Removendo a fonte de teste =="
  curl -fsS --max-time 15 -X DELETE "$BASE/api/sources/$SOURCE_ID" > /dev/null || fail "não foi possível remover a fonte de teste"
  if curl -fsS --max-time 15 "$BASE/api/sources" | grep -q "\"id\":\"$SOURCE_ID\""; then
    fail "fonte de teste continuou após DELETE"
  fi
else
  echo "AVISO: resolução de fonte indisponível (rede externa) — etapa de sincronização ignorada"
fi

echo "== Chaves de API (criptografia) =="
SECRETS0="$(curl -fsS --max-time 15 "$BASE/api/secrets" || true)"
printf '%s' "$SECRETS0" | grep -q '"id":"tmdb"' || fail "/api/secrets não devolveu as chaves esperadas"

curl -fsS --max-time 15 -X PUT -H 'content-type: application/json' \
  -d '{"value":"TESTE123456"}' "$BASE/api/secrets/ggdeals" > /tmp/secret-set.json \
  || fail "não foi possível salvar uma chave"
CONFIGURED="$(python3 -c 'import sys,json;d=json.load(open("/tmp/secret-set.json"));print([s["configured"] for s in d["secrets"] if s["id"]=="ggdeals"][0])')"
[ "$CONFIGURED" = "True" ] || fail "chave salva não apareceu como configurada"

curl -fsS --max-time 15 -X DELETE "$BASE/api/secrets/ggdeals" > /tmp/secret-del.json \
  || fail "não foi possível remover a chave"
CONFIGURED="$(python3 -c 'import sys,json;d=json.load(open("/tmp/secret-del.json"));print([s["configured"] for s in d["secrets"] if s["id"]=="ggdeals"][0])')"
[ "$CONFIGURED" = "False" ] || fail "chave removida continuou configurada"
echo "chaves de API ok (salvar/remover)"

echo "== Busca e fonte AniList (sem chave de API) =="
SEARCH="$(curl -fsS --max-time 30 "$BASE/api/media/search?provider=anilist&q=one%20piece" || true)"
SEARCH_COUNT="$(printf '%s' "$SEARCH" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("results",[])))' 2>/dev/null || echo 0)"
echo "resultados AniList: $SEARCH_COUNT"
[ "$SEARCH_COUNT" -gt 0 ] || echo "AVISO: busca do AniList indisponível (rede externa)"

FROM="$(date -u -d '-30 days' +%F)"
TO="$(date -u -d '+120 days' +%F)"
CAL_COUNT=0
if [ "$SEARCH_COUNT" -gt 0 ]; then
  ANIME_REF="$(printf '%s' "$SEARCH" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][0]["ref"])')"
  echo "fonte de teste: $ANIME_REF"
  ANIME_CREATE="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
    -d "{\"type\":\"anilist\",\"input\":\"$ANIME_REF\",\"categoryId\":\"anime\"}" "$BASE/api/sources" || true)"
  ANIME_ID="$(printf '%s' "$ANIME_CREATE" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  [ -n "$ANIME_ID" ] || fail "fonte AniList não foi criada"

  INDEX=0
  while [ "$INDEX" -lt 12 ]; do
    CAL="$(curl -fsS --max-time 20 "$BASE/api/calendar?scope=library&from=$FROM&to=$TO" || true)"
    CAL_COUNT="$(printf '%s' "$CAL" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("events",[])))' 2>/dev/null || echo 0)"
    if [ "$CAL_COUNT" -gt 0 ]; then break; fi
    INDEX=$((INDEX + 1))
    sleep 5
  done
  echo "calendário da biblioteca: $CAL_COUNT evento(s)"
  if [ "$CAL_COUNT" -le 0 ]; then
    echo "runs da fonte: $(curl -fsS --max-time 15 "$BASE/api/sources/$ANIME_ID/runs" | cut -c1-400)"
    fail "a fonte AniList não gerou eventos de calendário"
  fi

  curl -fsS --max-time 15 -X DELETE "$BASE/api/sources/$ANIME_ID" > /dev/null || fail "não foi possível remover a fonte AniList"
else
  echo "AVISO: etapa AniList ignorada"
fi

echo "== Calendário global =="
GLOBAL_FROM="$(date -u -d '-30 days' +%F)"
GLOBAL_TO="$(date -u -d '+60 days' +%F)"
GLOBAL_COUNT=0
INDEX=0
while [ "$INDEX" -lt 12 ]; do
  GLOBAL="$(curl -fsS --max-time 20 "$BASE/api/calendar?scope=global&from=$GLOBAL_FROM&to=$GLOBAL_TO" || true)"
  GLOBAL_COUNT="$(printf '%s' "$GLOBAL" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("events",[])))' 2>/dev/null || echo 0)"
  if [ "$GLOBAL_COUNT" -gt 0 ]; then break; fi
  INDEX=$((INDEX + 1))
  sleep 5
done
echo "calendário global: $GLOBAL_COUNT evento(s)"
[ "$GLOBAL_COUNT" -gt 0 ] || echo "AVISO: calendário global vazio (rede externa ou AniList fora do ar)"

echo "== Abrindo o Calendário no app =="
adb shell input tap 160 617 || true
sleep 6
adb exec-out screencap -p > android-calendar.png || true

echo "== Stremio: addon, catálogos e título =="
ADDON="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"url":"https://v3-cinemeta.strem.io/manifest.json"}' "$BASE/api/stremio/addons" || true)"
ADDON_ID="$(printf '%s' "$ADDON" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("addon",{}).get("id",""))' 2>/dev/null || true)"

if [ -n "$ADDON_ID" ]; then
  CATALOGS="$(curl -fsS --max-time 20 "$BASE/api/stremio/catalogs" || true)"
  CAT_COUNT="$(printf '%s' "$CATALOGS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("catalogs",[])))' 2>/dev/null || echo 0)"
  echo "catálogos do addon: $CAT_COUNT"
  [ "$CAT_COUNT" -gt 0 ] || fail "addon instalado sem catálogos"

  CATALOG_ID="$(printf '%s' "$CATALOGS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["catalogs"][0]["catalogId"])')"
  CATALOG_TYPE="$(printf '%s' "$CATALOGS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["catalogs"][0]["type"])')"
  PAGE="$(curl -fsS --max-time 30 "$BASE/api/stremio/catalog?addonId=$ADDON_ID&type=$CATALOG_TYPE&catalogId=$CATALOG_ID" || true)"
  PAGE_COUNT="$(printf '%s' "$PAGE" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("items",[])))' 2>/dev/null || echo 0)"
  echo "itens do catálogo: $PAGE_COUNT"
  [ "$PAGE_COUNT" -gt 0 ] || echo "AVISO: catálogo vazio"

  TITLE="$(curl -fsS --max-time 30 "$BASE/api/stremio/title/movie/tt0111161" || true)"
  case "$TITLE" in
    *'"name"'*) echo "detalhes do título ok" ;;
    *) echo "AVISO: detalhes do título indisponíveis" ;;
  esac

  curl -fsS --max-time 15 -X DELETE "$BASE/api/stremio/addons/$ADDON_ID" > /dev/null || fail "não foi possível remover o addon"
else
  echo "AVISO: Cinemeta indisponível (rede externa) — etapa Stremio ignorada"
fi

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
