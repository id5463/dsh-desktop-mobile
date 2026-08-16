package com.dshd.blue;

import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 手机端本地代理：监听手机 127.0.0.1:3080。
 * 两种上游模式：
 *  - LAN：透明 TCP 转发到桌面局域网 IP
 *  - REMOTE：解析 HTTP 请求，经 P2P 桥接（MQTT+WebRTC）转发到桌面端
 * WebView 加载 http://127.0.0.1:3080，Host/Origin 天然是 127.0.0.1。
 */
public class LocalProxyServer {

    public interface ProxyListener {
        void onStarted(int localPort);
        void onError(String message);
    }

    private static final String TAG = "LocalProxy";
    private static final int LISTEN_PORT = 3080;

    private static LocalProxyServer active;

    /** 启动局域网模式代理 */
    public static LocalProxyServer startLan(String targetHost, int targetPort, ProxyListener listener) {
        return start(new Config(targetHost, targetPort, null), listener);
    }

    /** 启动远程模式代理（经 P2P 桥接） */
    public static LocalProxyServer startRemote(P2PBridgeManager bridge, ProxyListener listener) {
        return start(new Config(null, 0, bridge), listener);
    }

    private static LocalProxyServer start(Config config, ProxyListener listener) {
        if (active != null) active.stop();
        active = new LocalProxyServer(config);
        active.listener = listener;
        active.start();
        return active;
    }

    /** 停止当前代理 */
    public static void stopActive() {
        if (active != null) active.stop();
        active = null;
    }

    /** 上游配置：LAN 用 host/port，REMOTE 用 bridge */
    private static class Config {
        final String targetHost;
        final int targetPort;
        final P2PBridgeManager bridge;
        Config(String targetHost, int targetPort, P2PBridgeManager bridge) {
            this.targetHost = targetHost;
            this.targetPort = targetPort;
            this.bridge = bridge;
        }
    }

    private final Config config;
    private ServerSocket serverSocket;
    private ExecutorService pool;
    private volatile boolean running = false;
    private ProxyListener listener;

    private LocalProxyServer(Config config) {
        this.config = config;
    }

    private void start() {
        if (running) return;
        running = true;
        pool = Executors.newCachedThreadPool();
        pool.submit(this::acceptLoop);
    }

    private void acceptLoop() {
        try {
            serverSocket = new ServerSocket();
            serverSocket.setReuseAddress(true);
            serverSocket.bind(new InetSocketAddress("127.0.0.1", LISTEN_PORT));
            int port = serverSocket.getLocalPort();
            String mode = config.bridge != null ? "REMOTE(桥接)" : "LAN(" + config.targetHost + ":" + config.targetPort + ")";
            Log.d(TAG, "代理监听 127.0.0.1:" + port + " 模式=" + mode);
            if (listener != null) listener.onStarted(port);

            while (running) {
                try {
                    Socket client = serverSocket.accept();
                    pool.submit(() -> handleClient(client));
                } catch (IOException e) {
                    if (running) Log.e(TAG, "accept error: " + e.getMessage());
                }
            }
        } catch (IOException e) {
            Log.e(TAG, "代理启动失败: " + e.getMessage());
            running = false;
            if (listener != null) listener.onError("代理启动失败: " + e.getMessage());
        }
    }

    private void handleClient(Socket client) {
        if (config.bridge != null) {
            handleRemote(client);
        } else {
            handleLan(client);
        }
    }

    // ===== LAN 模式：透明 TCP 转发 =====

    private void handleLan(Socket client) {
        Socket upstream = null;
        try {
            client.setTcpNoDelay(true);
            upstream = new Socket();
            upstream.setTcpNoDelay(true);
            upstream.connect(new InetSocketAddress(config.targetHost, config.targetPort), 5000);
            Log.d(TAG, "LAN 连接成功 -> " + config.targetHost + ":" + config.targetPort);
            pipe(client, upstream);
        } catch (IOException e) {
            Log.e(TAG, "LAN 转发失败: " + e.getMessage());
        } finally {
            closeQuietly(client);
            closeQuietly(upstream);
        }
    }

    private void pipe(Socket a, Socket b) {
        pool.submit(() -> copyStream(a, b));
        copyStream(b, a);
    }

    private void copyStream(Socket from, Socket to) {
        try {
            InputStream in = from.getInputStream();
            OutputStream out = to.getOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while (running && (n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                out.flush();
            }
        } catch (IOException ignored) {
        }
    }

    // ===== REMOTE 模式：解析 HTTP → P2P 桥接转发 =====

    private void handleRemote(Socket client) {
        try {
            InputStream in = client.getInputStream();
            OutputStream out = client.getOutputStream();

            // 解析 HTTP 请求行和头
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(in, "UTF-8"));
            String requestLine = reader.readLine();
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            String method = parts[0];
            String path = parts.length > 1 ? parts[1] : "/";

            String line;
            int contentLength = 0;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.toLowerCase().startsWith("content-length:")) {
                    try { contentLength = Integer.parseInt(line.substring(15).trim()); } catch (Exception ignored) {}
                }
            }
            String body = "";
            if (contentLength > 0) {
                char[] buf = new char[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = reader.read(buf, read, contentLength - read);
                    if (n == -1) break;
                    read += n;
                }
                body = new String(buf, 0, read);
            }

            // 经 P2P 桥接发送请求
            config.bridge.sendHttpRequest(method, path, body, responseJson -> {
                try {
                    if (responseJson == null) {
                        writeResponse(out, 502, "text/plain", "P2P 通道未连接");
                        return;
                    }
                    JSONObject resp = new JSONObject(responseJson);
                    int status = resp.optInt("status", 502);
                    String respBody = resp.optString("body", "");
                    String contentType = resp.optJSONObject("headers") != null
                            ? resp.optJSONObject("headers").optString("content-type", "text/html; charset=utf-8")
                            : "text/html; charset=utf-8";
                    writeResponse(out, status, contentType, respBody);
                } catch (Exception e) {
                    writeResponse(out, 502, "text/plain", "解析响应失败: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "REMOTE 处理失败: " + e.getMessage());
        } finally {
            closeQuietly(client);
        }
    }

    private void writeResponse(OutputStream out, int status, String contentType, String body) {
        try {
            byte[] bodyBytes = body.getBytes("UTF-8");
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(status).append("\r\n");
            sb.append("Content-Type: ").append(contentType).append("\r\n");
            sb.append("Content-Length: ").append(bodyBytes.length).append("\r\n");
            sb.append("Connection: close\r\n\r\n");
            out.write(sb.toString().getBytes("UTF-8"));
            out.write(bodyBytes);
            out.flush();
        } catch (IOException e) {
            Log.e(TAG, "写响应失败: " + e.getMessage());
        }
    }

    private void stop() {
        running = false;
        closeQuietly(serverSocket);
        if (pool != null) {
            pool.shutdownNow();
            pool = null;
        }
    }

    private void closeQuietly(Object o) {
        try {
            if (o instanceof Socket) ((Socket) o).close();
            else if (o instanceof ServerSocket) ((ServerSocket) o).close();
        } catch (IOException ignored) {
        }
    }
}