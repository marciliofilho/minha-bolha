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

echo "== Progresso de reprodução =="
PB="$(curl -fsS --max-time 20 -X PUT -H 'content-type: application/json' \
  -d '{"metaId":"tt0111161","type":"movie","videoId":"tt0111161","positionMs":120000,"durationMs":600000,"name":"Um Sonho de Liberdade"}' \
  "$BASE/api/playback/progress" || true)"
POS="$(printf '%s' "$PB" | python3 -c 'import sys,json;print(int(json.load(sys.stdin)["progress"]["positionMs"]))' 2>/dev/null || echo -1)"
[ "$POS" = "120000" ] || fail "progresso não foi salvo (posição=$POS)"
PCT="$(printf '%s' "$PB" | python3 -c 'import sys,json;print(round(json.load(sys.stdin)["progress"]["progress"],2))' 2>/dev/null || echo '?')"
CONTINUE="$(curl -fsS --max-time 15 "$BASE/api/playback/continue" || true)"
CONTINUE_COUNT="$(printf '%s' "$CONTINUE" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("items",[])))' 2>/dev/null || echo 0)"
[ "$CONTINUE_COUNT" -ge 1 ] || fail "continuar assistindo ficou vazio"
curl -fsS --max-time 15 -X DELETE "$BASE/api/playback/progress?metaId=tt0111161&videoId=tt0111161" > /dev/null \
  || fail "não foi possível remover o progresso"
LEFT="$(curl -fsS --max-time 15 "$BASE/api/playback/continue" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("items",[])))' 2>/dev/null || echo -1)"
[ "$LEFT" = "0" ] || fail "progresso continuou após DELETE"
echo "progresso ok (${PCT})"

echo "== Streams do Stremio =="
ENGINE="$(curl -fsS --max-time 30 "$BASE/api/stremio/torrent/engine" || true)"
ENGINE_OK="$(printf '%s' "$ENGINE" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("available"))' 2>/dev/null || echo False)"
echo "motor de torrents: $ENGINE"
[ "$ENGINE_OK" = "True" ] || fail "libtorrent não carregou no emulador ($ENGINE)"

TORRENTIO="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"url":"https://torrentio.strem.fun/manifest.json"}' "$BASE/api/stremio/addons" || true)"
TORRENTIO_ID="$(printf '%s' "$TORRENTIO" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("addon",{}).get("id",""))' 2>/dev/null || true)"

if [ -n "$TORRENTIO_ID" ]; then
  STREAMS="$(curl -fsS --max-time 60 "$BASE/api/stremio/streams?type=movie&id=tt0111161" || true)"
  STREAM_COUNT="$(printf '%s' "$STREAMS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("streams",[])))' 2>/dev/null || echo 0)"
  DIRECT_COUNT="$(printf '%s' "$STREAMS" | python3 -c 'import sys,json;print(sum(1 for s in json.load(sys.stdin).get("streams",[]) if s.get("playbackUrl")))' 2>/dev/null || echo 0)"
  echo "streams: $STREAM_COUNT (com URL reproduzível: $DIRECT_COUNT)"
  [ "$STREAM_COUNT" -gt 0 ] || echo "AVISO: addon de streams não devolveu resultados"

  # Prepara um torrent (prefere MP4, que o WebView reproduz direto).
  PREP_BODY="$(printf '%s' "$STREAMS" | python3 -c '
import sys,json
d=json.load(sys.stdin)
streams=[s for s in d.get("streams",[]) if s.get("infoHash")]
def is_mp4(s):
    text=((s.get("title") or "")+" "+(s.get("name") or "")+" "+(s.get("description") or "")).lower()
    return ".mp4" in text or " mp4" in text
chosen=[s for s in streams if is_mp4(s)] or streams
if chosen:
    s=chosen[0]
    print(json.dumps({"infoHash": s["infoHash"], "fileIdx": s.get("fileIdx"), "sources": s.get("sources") or []}))
' 2>/dev/null || true)"

  if [ -n "$PREP_BODY" ]; then
    PREP_CODE="$(curl -s -o /tmp/prep.json -w '%{http_code}' --max-time 90 -X POST \
      -H 'content-type: application/json' -d "$PREP_BODY" \
      "$BASE/api/stremio/torrent/prepare" || true)"
    case "$PREP_CODE" in
      200)
        SESSION_ID="$(python3 -c 'import json;print(json.load(open("/tmp/prep.json"))["sessionId"])' 2>/dev/null || true)"
        PLAYABLE="$(python3 -c 'import json;print(json.load(open("/tmp/prep.json"))["directPlayable"])' 2>/dev/null || echo False)"
        echo "torrent preparado: $(python3 -c 'import json;d=json.load(open("/tmp/prep.json"));print(d["fileName"], str(d["fileLength"])+" bytes", "directPlayable="+str(d["directPlayable"]))' 2>/dev/null)"
        if [ "$PLAYABLE" = "True" ]; then
          RAW_CODE="$(curl -s -o /tmp/raw.bin -w '%{http_code}' --max-time 60 -H 'Range: bytes=0-1023' \
            "$BASE/api/stremio/torrent/$SESSION_ID/raw" || true)"
          if [ "$RAW_CODE" = "206" ]; then
            echo "range ok ($(wc -c < /tmp/raw.bin) bytes)"
          else
            echo "AVISO: range retornou $RAW_CODE"
          fi
        else
          echo "container exige o player nativo (esperado: Media3/ExoPlayer)"
        fi
        curl -s --max-time 15 -X DELETE "$BASE/api/stremio/torrent/$SESSION_ID" > /dev/null || true
        ;;
      422)
        echo "motor ok; arquivo precisa de transcodificação: $(cut -c1-160 /tmp/prep.json)"
        ;;
      *)
        echo "AVISO: prepare retornou $PREP_CODE ($(cut -c1-160 /tmp/prep.json))"
        ;;
    esac
  fi

  curl -fsS --max-time 15 -X DELETE "$BASE/api/stremio/addons/$TORRENTIO_ID" > /dev/null || true
else
  echo "AVISO: Torrentio indisponível (rede externa) — etapa de streams ignorada"
fi

echo "== Legendas do Stremio =="
OPENSUBS="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"url":"https://opensubtitles-v3.strem.io/manifest.json"}' "$BASE/api/stremio/addons" || true)"
OPENSUBS_ID="$(printf '%s' "$OPENSUBS" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("addon",{}).get("id",""))' 2>/dev/null || true)"

if [ -n "$OPENSUBS_ID" ]; then
  SUBS="$(curl -fsS --max-time 60 "$BASE/api/stremio/subtitles?type=movie&id=tt0111161" || true)"
  SUBS_COUNT="$(printf '%s' "$SUBS" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("subtitles",[])))' 2>/dev/null || echo 0)"
  echo "legendas: $SUBS_COUNT"
  if [ "$SUBS_COUNT" -gt 0 ]; then
    PROXY_URL="$(printf '%s' "$SUBS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["subtitles"][0]["proxyUrl"])' 2>/dev/null || true)"
    if [ -n "$PROXY_URL" ]; then
      VTT="$(curl -fsS --max-time 30 "$BASE$PROXY_URL" || true)"
      case "$VTT" in
        WEBVTT*) echo "proxy de legenda ok (WebVTT)" ;;
        *) fail "proxy de legenda não devolveu WebVTT" ;;
      esac
    fi
  else
    echo "AVISO: addon de legendas não devolveu faixas"
  fi
  curl -s --max-time 15 -X DELETE "$BASE/api/stremio/addons/$OPENSUBS_ID" > /dev/null || true
else
  echo "AVISO: addon de legendas indisponível (rede externa) — etapa ignorada"
fi

echo "== Biblioteca Stremio (estado local) =="
STATUS="$(curl -fsS --max-time 20 "$BASE/api/stremio/status" || true)"
case "$STATUS" in
  *'"connected":false'*) echo "status ok (conta desconectada)" ;;
  *) fail "status do Stremio inválido" ;;
esac

STATE="$(curl -fsS --max-time 20 -X PATCH -H 'content-type: application/json' \
  -d '{"isFavorite":true,"inLibrary":true,"type":"movie","name":"Um Sonho de Liberdade"}' \
  "$BASE/api/stremio/library/tt0111161/state" || true)"
case "$STATE" in
  *'"isFavorite":true'*) echo "favorito local ok" ;;
  *) fail "estado local do Stremio não salvou o favorito" ;;
esac

LIB="$(curl -fsS --max-time 20 "$BASE/api/stremio/library?search=sonho" || true)"
LIB_COUNT="$(printf '%s' "$LIB" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("items",[])))' 2>/dev/null || echo 0)"
echo "biblioteca local: $LIB_COUNT item(ns)"
[ "$LIB_COUNT" -ge 1 ] || fail "item local não apareceu na biblioteca"

curl -s --max-time 15 -X PATCH -H 'content-type: application/json' -d '{"inLibrary":false}' \
  "$BASE/api/stremio/library/tt0111161/state" > /dev/null || true

echo "== Jogos (Steam) =="
GAME="$(curl -fsS --max-time 40 -X POST -H 'content-type: application/json' \
  -d '{"appid":620}' "$BASE/api/games" || true)"
GAME_ID="$(printf '%s' "$GAME" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
if [ -n "$GAME_ID" ]; then
  GAME_NAME="$(printf '%s' "$GAME" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("name",""))' 2>/dev/null || true)"
  echo "jogo adicionado: $GAME_NAME"

  LIST="$(curl -fsS --max-time 20 "$BASE/api/games" || true)"
  TOTAL="$(printf '%s' "$LIST" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("stats",{}).get("total",0))' 2>/dev/null || echo 0)"
  [ "$TOTAL" -ge 1 ] || fail "jogo não apareceu na lista"

  PATCHED="$(curl -fsS --max-time 20 -X PATCH -H 'content-type: application/json' \
    -d '{"targetPriceCents":1999}' "$BASE/api/games/$GAME_ID" || true)"
  case "$PATCHED" in
    *'"targetPriceCents":1999'*) echo "preço-alvo ok" ;;
    *) fail "preço-alvo não foi salvo" ;;
  esac

  REFRESH="$(curl -fsS --max-time 40 -X POST "$BASE/api/games/$GAME_ID/refresh-price" || true)"
  case "$REFRESH" in
    *'"game"'*) echo "atualização de preço ok" ;;
    *) echo "AVISO: refresh de preço não respondeu como esperado" ;;
  esac

  curl -s --max-time 15 -X DELETE "$BASE/api/games/$GAME_ID" > /dev/null || true
else
  echo "AVISO: Steam indisponível (rede externa) — etapa de jogos ignorada"
fi

echo "== Backup =="
EXPORT="$(curl -fsS --max-time 30 "$BASE/api/backup/export" || true)"
FORMAT="$(printf '%s' "$EXPORT" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("format"),d.get("version"))' 2>/dev/null || true)"
echo "export: $FORMAT"
case "$FORMAT" in
  "hub-backup 2") : ;;
  *) fail "exportação de backup inválida" ;;
esac

PREVIEW="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' -d "$EXPORT" \
  "$BASE/api/backup/preview" || true)"
printf '%s' "$PREVIEW" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert "exportedAt" in d and "sources" in d;print("preview ok:", d["settingsFields"], "campos")' \
  || fail "prévia do backup inválida"

IMPORTED="$(curl -fsS --max-time 30 -X POST -H 'content-type: application/json' -d "$EXPORT" \
  "$BASE/api/backup/import" || true)"
printf '%s' "$IMPORTED" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d.get("settingsUpdated") is True;print("import ok:", d.get("categoriesImported"), "categoria(s)")' \
  || fail "importação do backup falhou"

echo "== Extração de novels/artigos (WebView) =="
ARTICLE="$(curl -fsS --max-time 60 "$BASE/api/articles/content?url=https%3A%2F%2Fexample.com%2F" || true)"
ARTICLE_TITLE="$(printf '%s' "$ARTICLE" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("title",""))' 2>/dev/null || true)"
ARTICLE_LEN="$(printf '%s' "$ARTICLE" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("text","")))' 2>/dev/null || echo 0)"
echo "extração: \"$ARTICLE_TITLE\" ($ARTICLE_LEN caracteres)"
if [ "$ARTICLE_LEN" -gt 20 ]; then
  echo "WebView extraiu texto"
else
  echo "AVISO: extração não devolveu texto (rede externa ou página dinâmica)"
  adb logcat -d -s MinhaBolha:I | tail -n 20
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

if adb logcat -d -s MinhaBolha:I | grep -q 'native=1'; then
  echo "ponte HubNative presente"
else
  fail "window.HubNative não foi injetada no WebView"
fi

if adb logcat -d -s MinhaBolha:I | grep -q 'console: Uncaught'; then
  fail "erro JavaScript não tratado no WebView"
fi

echo "== Serviço em primeiro plano =="
MERGED="$(find apps/android/app/build/intermediates -name AndroidManifest.xml -path '*debug*' 2>/dev/null | head -n 1)"
if [ -n "$MERGED" ]; then
  if grep -q "HubForegroundService" "$MERGED"; then
    echo "serviço de torrents declarado no manifest final"
  else
    fail "HubForegroundService não está no manifest final"
  fi
  if grep -q "PlaybackService" "$MERGED" && grep -q "androidx.media3.session.MediaSessionService" "$MERGED"; then
    echo "MediaSessionService declarado no manifest final"
  else
    fail "PlaybackService/MediaSessionService ausente no manifest final"
  fi
  if grep -q "BrowserActivity" "$MERGED"; then
    echo "navegador embutido declarado no manifest final"
  else
    fail "BrowserActivity ausente no manifest final"
  fi
  if grep -q "FOREGROUND_SERVICE_MEDIA_PLAYBACK" "$MERGED"; then
    echo "permissão de mídia em primeiro plano ok"
  else
    fail "permissão FOREGROUND_SERVICE_MEDIA_PLAYBACK ausente"
  fi
else
  echo "AVISO: manifest final não encontrado para inspeção"
fi

PLAYER_PAYLOAD='{"url":"/api/health","title":"Teste foreground","tracking":{"metaId":"tt0111161","type":"movie","videoId":"tt0111161"}}'
adb shell am start -n com.minhabolha.android/.PlayerActivity \
  --es payload "$PLAYER_PAYLOAD" --es baseUrl "http://127.0.0.1:$PORT" > /dev/null 2>&1 || true
sleep 4
if adb shell dumpsys activity services com.minhabolha.android | grep -q "HubForegroundService"; then
  echo "serviço em primeiro plano ativo"
else
  echo "AVISO: serviço não ficou ativo (Activity não exportada pode bloquear o teste)"
fi
adb shell am force-stop com.minhabolha.android > /dev/null 2>&1 || true

echo "Smoke test Android OK"
