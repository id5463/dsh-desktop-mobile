package com.dshd.blue;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * P2P 连接管理器：通过隐藏 WebView 运行 PeerJS，与桌面端建立 WebRTC 连接
 * 同时运行本地 HTTP 代理，将 WebView 的请求转发到桌面端
 */
public class P2PConnectionManager {

    public interface ConnectionListener {
        void onConnected(String peerId);
        void onDisconnected();
        void onError(String message);
        void onProxyReady(int localPort);
    }

    private static final String TAG = "P2PManager";
    private static final String PEERJS_HOST = "0.peerjs.com";
    private static final String PEERJS_SERVER = "https://0.peerjs.com/peerjs";
    private static final String STUN_SERVER = "stun:stun.l.google.com:19302";

    private final Context context;
    private WebView p2pWebView;
    private LocalProxyServer proxyServer;
    private ConnectionListener listener;
    private String desktopPeerId;
    private String localPeerId;
    private boolean connected = false;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public P2PConnectionManager(Context context) {
        this.context = context;
    }

    public void setListener(ConnectionListener listener) {
        this.listener = listener;
    }

    /**
     * 连接到桌面端
     * @param code 连接码 (格式: dsh-XXXX)
     */
    public void connect(String code) {
        this.desktopPeerId = code.trim();
        mainHandler.post(this::initP2PWebView);
    }

    /**
     * 断开连接
     */
    public void disconnect() {
        connected = false;
        if (p2pWebView != null) {
            p2pWebView.evaluateJavascript(
                "if(window.peer) { peer.destroy(); }", null);
            p2pWebView.destroy();
            p2pWebView = null;
        }
        if (proxyServer != null) {
            proxyServer.stop();
            proxyServer = null;
        }
        if (listener != null) listener.onDisconnected();
    }

    public boolean isConnected() { return connected; }
    public String getLocalPeerId() { return localPeerId; }

    /**
     * 通过 P2P 通道发送 HTTP 请求，返回响应体
     */
    public String sendHttpRequest(String method, String path, String body) {
        if (!connected) return null;
        // 通过 PeerJS 数据通道发送请求
        // 由于 PeerJS 在 WebView 中，我们通过 evaluateJavascript 通信
        final String[] result = new String[1];
        final Object lock = new Object();

        String js = String.format(
            "window.sendHttpRequest && window.sendHttpRequest('%s', '%s', '%s', '%s')",
            method, path.replace("'", "\\'"),
            body != null ? body.replace("'", "\\'") : "",
            "req_" + System.currentTimeMillis()
        );

        mainHandler.post(() -> {
            p2pWebView.evaluateJavascript(js, value -> {
                synchronized (lock) {
                    result[0] = value;
                    lock.notify();
                }
            });
        });

        synchronized (lock) {
            try { lock.wait(10000); } catch (InterruptedException e) { }
        }
        return result[0];
    }

    /**
     * 获取本地代理 URL（WebView 应加载此地址）
     */
    public String getProxyUrl() {
        if (proxyServer != null) {
            return "http://127.0.0.1:" + proxyServer.getPort();
        }
        return null;
    }

    // ========== 内部实现 ==========

    private void initP2PWebView() {
        if (p2pWebView != null) {
            p2pWebView.destroy();
        }

        p2pWebView = new WebView(context);
        p2pWebView.getSettings().setJavaScriptEnabled(true);
        p2pWebView.getSettings().setDomStorageEnabled(true);
        p2pWebView.getSettings().setAllowFileAccess(true);
        p2pWebView.getSettings().setAllowContentAccess(true);
        p2pWebView.addJavascriptInterface(new P2PBridge(), "P2PBridge");

        p2pWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // 通过 MQTT 连接桌面端，desktopPeerId 就是连接码 dsh-XXXX
                view.evaluateJavascript(
                    "connectToDesktop('" + desktopPeerId + "');", null);
                Log.d(TAG, "P2P: connectToDesktop('" + desktopPeerId + "')");
            }
        });

        p2pWebView.loadUrl("file:///android_asset/p2p-bridge.html");
        Log.d(TAG, "P2P WebView initialized from assets");
    }

    /**
     * JavaScript 桥接：PeerJS → Android
     */
    public class P2PBridge {
        @JavascriptInterface
        public void onPeerReady(String id) {
            localPeerId = id;
            Log.d(TAG, "Local peer ID: " + id);
        }

        @JavascriptInterface
        public void onConnected() {
            connected = true;
            Log.d(TAG, "Connected to desktop: " + desktopPeerId);
            // 启动本地代理
            startLocalProxy();
            mainHandler.post(() -> {
                if (listener != null) listener.onConnected(desktopPeerId);
            });
        }

        @JavascriptInterface
        public void onDisconnected() {
            connected = false;
            mainHandler.post(() -> {
                if (listener != null) listener.onDisconnected();
            });
        }

        @JavascriptInterface
        public void onError(String message) {
            Log.e(TAG, "P2P Error: " + message);
            mainHandler.post(() -> {
                if (listener != null) listener.onError(message);
            });
        }
    }

    /**
     * 启动本地 HTTP 代理服务器
     */
    private void startLocalProxy() {
        if (proxyServer != null) return;
        proxyServer = new LocalProxyServer(this);
        proxyServer.start();
        int port = proxyServer.getPort();
        Log.d(TAG, "Local proxy started on port " + port);
        mainHandler.post(() -> {
            if (listener != null) listener.onProxyReady(port);
        });
    }

    /**
     * 本地 HTTP 代理服务器：接收 WebView 的请求，通过 P2P 转发到桌面端
     */
    private static class LocalProxyServer {
        private final P2PConnectionManager manager;
        private java.net.ServerSocket serverSocket;
        private volatile boolean running = false;
        private int port = 8888;
        private final ExecutorService pool = Executors.newCachedThreadPool();

        LocalProxyServer(P2PConnectionManager manager) {
            this.manager = manager;
        }

        void start() {
            running = true;
            pool.submit(() -> {
                try {
                    serverSocket = new java.net.ServerSocket(port);
                    port = serverSocket.getLocalPort();
                    Log.d(TAG, "Proxy listening on " + port);

                    while (running) {
                        try {
                            java.net.Socket client = serverSocket.accept();
                            pool.submit(() -> handleClient(client));
                        } catch (Exception e) {
                            if (running) Log.e(TAG, "Accept error: " + e.getMessage());
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Server error: " + e.getMessage());
                }
            });
        }

        void stop() {
            running = false;
            try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
            pool.shutdown();
        }

        int getPort() { return port; }

        private void handleClient(java.net.Socket client) {
            try {
                java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(client.getInputStream(), "UTF-8"));
                java.io.OutputStreamWriter writer = new java.io.OutputStreamWriter(
                    client.getOutputStream(), "UTF-8");

                // 解析 HTTP 请求
                String requestLine = reader.readLine();
                if (requestLine == null) { client.close(); return; }

                String[] parts = requestLine.split(" ");
                String method = parts[0];
                String path = parts.length > 1 ? parts[1] : "/";

                // 读取请求头
                StringBuilder headers = new StringBuilder();
                String line;
                int contentLength = 0;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    headers.append(line).append("\r\n");
                    if (line.toLowerCase().startsWith("content-length:")) {
                        contentLength = Integer.parseInt(line.substring(15).trim());
                    }
                }

                // 读取请求体
                String body = "";
                if (contentLength > 0) {
                    char[] buf = new char[contentLength];
                    reader.read(buf, 0, contentLength);
                    body = new String(buf, 0, contentLength);
                }

                // 通过 P2P 通道发送请求
                String response = manager.sendHttpRequest(method, path, body);

                if (response != null) {
                    writer.write("HTTP/1.1 200 OK\r\n");
                    writer.write("Content-Type: text/html; charset=utf-8\r\n");
                    writer.write("Content-Length: " + response.getBytes("UTF-8").length + "\r\n");
                    writer.write("Connection: close\r\n\r\n");
                    writer.write(response);
                } else {
                    // 返回等待页面
                    String waitingPage = "<html><body><h2>Connecting...</h2>"
                        + "<p>Waiting for P2P connection...</p>"
                        + "<script>setTimeout(function(){ location.reload(); }, 1000);</script>"
                        + "</body></html>";
                    writer.write("HTTP/1.1 200 OK\r\n");
                    writer.write("Content-Type: text/html; charset=utf-8\r\n");
                    writer.write("Content-Length: " + waitingPage.getBytes("UTF-8").length + "\r\n");
                    writer.write("Connection: close\r\n\r\n");
                    writer.write(waitingPage);
                }
                writer.flush();
                client.close();
            } catch (Exception e) {
                Log.e(TAG, "Client error: " + e.getMessage());
            }
        }
    }
}