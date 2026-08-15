package com.dsh.mobile;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.HashMap;
import java.util.Map;

/**
 * P2P 远程桥接管理器：隐藏 WebView 运行 MQTT + WebRTC，
 * Java 与 JS 通过 JavascriptInterface 交换 HTTP 请求/响应帧。
 */
public class P2PBridgeManager {

    public interface Listener {
        void onConnected();
        void onError(String message);
        /** 桌面端 UPnP 已开公网端口，可直接直连（免 WebRTC）；token 用于通过桌面端鉴权门 */
        default void onDirectConnect(String publicIp, int port, String token) {}
    }

    public interface ResponseCallback {
        /** @param responseJson 桌面端返回的完整 http-response JSON 字符串 */
        void onResponse(String responseJson);
    }

    private static final String TAG = "P2PBridge";

    private final Context context;
    private WebView bridgeWebView;
    private Listener listener;
    private final Map<String, ResponseCallback> pending = new HashMap<>();
    private long requestCounter = 0;

    public P2PBridgeManager(Context context) {
        this.context = context;
    }

    /**
     * 连接桌面端（通过连接码走 MQTT 信令）
     */
    public void connect(String desktopPeerId, Listener listener) {
        this.listener = listener;

        bridgeWebView = new WebView(context);
        bridgeWebView.getSettings().setJavaScriptEnabled(true);
        bridgeWebView.getSettings().setDomStorageEnabled(true);
        bridgeWebView.getSettings().setAllowFileAccess(true);
        bridgeWebView.getSettings().setAllowContentAccess(true);
        bridgeWebView.addJavascriptInterface(new Bridge(), "P2PBridge");
        bridgeWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // 老 WebView 解析大 JS 慢，onPageFinished 时函数可能还没定义好，重试
                retryConnect(desktopPeerId, 10);
            }
        });
        bridgeWebView.loadUrl("file:///android_asset/p2p-bridge.html");
    }

    private void retryConnect(String peerId, int attempts) {
        if (attempts <= 0 || bridgeWebView == null) return;
        bridgeWebView.evaluateJavascript(
                "typeof connectToDesktop === 'function' ? connectToDesktop('" + peerId + "') : 'not-ready'",
                value -> {
                    String v = value == null ? "null" : value;
                    if (v.contains("not-ready")) {
                        Log.d(TAG, "bridge 未就绪，重试 " + attempts);
                        bridgeWebView.postDelayed(() -> retryConnect(peerId, attempts - 1), 1000);
                    } else {
                        Log.d(TAG, "connectToDesktop('" + peerId + "') called");
                    }
                });
    }

    /**
     * 通过 P2P 通道发送 HTTP 请求
     */
    public void sendHttpRequest(String method, String path, String body, ResponseCallback cb) {
        if (bridgeWebView == null) { cb.onResponse(null); return; }
        String reqId = "req" + (requestCounter++);
        pending.put(reqId, cb);
        String js = "window.sendHttpRequest && window.sendHttpRequest("
                + safeJs(method) + "," + safeJs(path) + "," + safeJs(body) + "," + safeJs(reqId) + ");";
        bridgeWebView.evaluateJavascript(js, null);
    }

    public void disconnect() {
        if (bridgeWebView != null) {
            bridgeWebView.evaluateJavascript("if(window.peer){peer.destroy()} if(window.mqttClient){mqttClient.end(true)}", null);
            bridgeWebView.destroy();
            bridgeWebView = null;
        }
        pending.clear();
    }

    /** 把字符串转成安全的 JS 单引号字符串字面量 */
    private static String safeJs(String s) {
        if (s == null) s = "";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "") + "'";
    }

    /** JS 桥：PeerJS/WebRTC 事件回调到 Java */
    public class Bridge {
        @JavascriptInterface
        public void onPeerReady(String id) {
            Log.d(TAG, "Peer ready: " + id);
        }

        @JavascriptInterface
        public void onConnected() {
            Log.d(TAG, "P2P connected");
            if (listener != null) listener.onConnected();
        }

        @JavascriptInterface
        public void onError(String message) {
            Log.e(TAG, "P2P error: " + message);
            if (listener != null) listener.onError(message);
        }

        @JavascriptInterface
        public void onHttpResponse(String requestId, String responseJson) {
            ResponseCallback cb = pending.remove(requestId);
            if (cb != null) cb.onResponse(responseJson);
        }

        @JavascriptInterface
        public void onPublicIp(String publicIp, int port, String token) {
            Log.d(TAG, "桌面端 UPnP 直连可用: " + publicIp + ":" + port);
            if (listener != null) listener.onDirectConnect(publicIp, port, token);
        }
    }
}