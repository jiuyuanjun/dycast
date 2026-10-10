import json
import sys
import time
import urllib.request
import websocket


def get_page_ws():
    with urllib.request.urlopen('http://localhost:9222/json') as resp:
        pages = json.loads(resp.read().decode())
    return pages[0]['webSocketDebuggerUrl']


def send(ws, method, params=None, session_id=None):
    msg = {'id': int(time.time() * 1000), 'method': method}
    if params:
        msg['params'] = params
    if session_id:
        msg['sessionId'] = session_id
    ws.send(json.dumps(msg))
    return json.loads(ws.recv())


def eval_js(ws, expr, session_id=None):
    return send(ws, 'Runtime.evaluate', {
        'expression': expr,
        'returnByValue': True,
        'awaitPromise': True
    }, session_id)


def main():
    ws_url = get_page_ws()
    print('Connecting to', ws_url)
    ws = websocket.create_connection(ws_url, origin='http://localhost:9222', suppress_origin=False)
    try:
        send(ws, 'Runtime.enable')
        send(ws, 'Console.enable')
        send(ws, 'Log.enable')

        time.sleep(2)

        room = sys.argv[1] if len(sys.argv) > 1 else '123456'
        js = f"""
            (function() {{
                const input = document.querySelector('input[type="text"], input');
                if (input) {{
                    input.value = '{room}';
                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                const btns = Array.from(document.querySelectorAll('button'));
                const connectBtn = btns.find(b => b.textContent.includes('连接') || b.textContent.includes('进入'));
                if (connectBtn) connectBtn.click();
                return {{ input: !!input, button: !!connectBtn, buttons: btns.map(b => b.textContent) }};
            }})()
        """
        res = eval_js(ws, js)
        print('connect result:', json.dumps(res, indent=2, ensure_ascii=False))

        for i in range(15):
            time.sleep(2)
            url_res = eval_js(ws, "location.href")
            print('URL:', url_res.get('result', {}).get('value'))
            store_res = eval_js(ws, """
                (function(){
                    try {
                        const store = window.__VUE__ ? window.__VUE__.apps[0]._instance.proxy.$store || window.__VUE__.apps[0]._instance.exposed : null;
                        return { store: !!store };
                    } catch(e) { return { error: e.message }; }
                })()
            """)
            print('store:', json.dumps(store_res, indent=2, ensure_ascii=False))
    finally:
        ws.close()


if __name__ == '__main__':
    main()
