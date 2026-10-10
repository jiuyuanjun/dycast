import websocket
import json
import time

ws_url = "ws://localhost:9222/devtools/page/86522085AC5FC0E897B93C67FC7B3775"
ws = websocket.create_connection(ws_url, origin="http://localhost:9222")

def send(method, params=None):
    msg = {"id": 1, "method": method}
    if params:
        msg["params"] = params
    ws.send(json.dumps(msg))
    return json.loads(ws.recv())

# Navigate to login-webview page
send("Runtime.evaluate", {"expression": "window.location.hash='#/login-webview'"})
time.sleep(1)

# Get current URL
res = send("Runtime.evaluate", {"expression": "window.location.href"})
print("URL:", res.get("result", {}).get("value", "unknown"))

ws.close()
