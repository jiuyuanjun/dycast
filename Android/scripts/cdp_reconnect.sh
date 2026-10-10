#!/bin/bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
for i in $(seq 1 10); do
  PID=$("$ADB" -s emulator-5554 shell pidof com.dycast.app | tr -d '\r' | awk '{print $1}')
  [ -z "$PID" ] && sleep 3 && continue
  "$ADB" -s emulator-5554 forward --remove tcp:9222 2>/dev/null
  "$ADB" -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null 2>&1
  R=$(curl -s --max-time 3 http://127.0.0.1:9222/json 2>/dev/null)
  if [ -n "$R" ]; then
    WS=$(echo "$R" | python -c "
import json,sys
pages=json.load(sys.stdin)
kw=sys.argv[1]
sel=[p for p in pages if kw in p['url']]
print(sel[0]['webSocketDebuggerUrl'] if sel else '')
" "$1" 2>/dev/null)
    if [ -n "$WS" ]; then echo "$WS"; exit 0; fi
  fi
  sleep 4
done
exit 1
