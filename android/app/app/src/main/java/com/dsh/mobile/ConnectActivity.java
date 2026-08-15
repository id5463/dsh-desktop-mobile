package com.dsh.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

public class ConnectActivity extends Activity {

    private static final int REQ_CAMERA = 100;
    private static final int REQ_SCAN = 1;

    private EditText codeInput, hostInput, portInput;
    private Button remoteBtn, lanBtn, scanBtn, discoverBtn, speedBtn;
    private TextView statusText;
    private SharedPreferences prefs;
    private P2PBridgeManager bridgeManager;
    private MDNSDiscover mdnsDiscover;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_connect);

        prefs = getSharedPreferences("dsh_mobile_prefs", MODE_PRIVATE);

        codeInput = findViewById(R.id.code_input);
        hostInput = findViewById(R.id.lan_host_input);
        portInput = findViewById(R.id.lan_port_input);
        remoteBtn = findViewById(R.id.remote_connect_button);
        lanBtn = findViewById(R.id.lan_connect_button);
        scanBtn = findViewById(R.id.scan_qr_button);
        discoverBtn = findViewById(R.id.auto_discover_button);
        speedBtn = findViewById(R.id.speed_test_button);
        statusText = findViewById(R.id.status_text);

        codeInput.setText(prefs.getString("last_code", ""));
        hostInput.setText(prefs.getString("host", "192.168.0.112"));
        portInput.setText(String.valueOf(prefs.getInt("port", 3080)));

        remoteBtn.setOnClickListener(v -> connectRemote());
        lanBtn.setOnClickListener(v -> connectLan());
        scanBtn.setOnClickListener(v -> openScanner());
        discoverBtn.setOnClickListener(v -> startAutoDiscovery());
        speedBtn.setOnClickListener(v -> speedTestConnect());
    }

    /** 已保存的访问令牌 → URL 查询串（桌面端鉴权门用）；无则返回空串 */
    private String tokenQuery() {
        String t = prefs.getString("last_token", "");
        return t.isEmpty() ? "" : "?token=" + t;
    }

    /** 保存令牌（二维码 / mDNS / UPnP offer / 测速来源） */
    private void saveToken(String token) {
        if (token != null && !token.isEmpty()) {
            prefs.edit().putString("last_token", token).apply();
        }
    }

    // ===== 测速自动选择（多服务器，参考 dsh-Remote, MIT） =====

    private void speedTestConnect() {
        statusText.setText("正在测速…");
        speedBtn.setEnabled(false);
        new Thread(() -> {
            final String[] bestHost = { null };
            final int[] bestPort = { 0 };
            final long[] bestMs = { Long.MAX_VALUE };
            final String[] bestToken = { "" };
            try {
                org.json.JSONArray arr = new org.json.JSONArray(prefs.getString("servers", "[]"));
                for (int i = 0; i < arr.length(); i++) {
                    org.json.JSONObject s = arr.getJSONObject(i);
                    String host = s.optString("host", "");
                    int port = s.optInt("port", 3080);
                    if (host.isEmpty()) continue;
                    long t0 = System.currentTimeMillis();
                    boolean ok = pingHost(host, port);
                    long ms = System.currentTimeMillis() - t0;
                    android.util.Log.d("SpeedTest", host + ":" + port + " = " + (ok ? ms + "ms" : "不可达"));
                    if (ok && ms < bestMs[0]) {
                        bestMs[0] = ms; bestHost[0] = host; bestPort[0] = port;
                        bestToken[0] = s.optString("token", "");
                    }
                }
            } catch (Exception e) {
                android.util.Log.e("SpeedTest", "测速失败: " + e.getMessage());
            }
            runOnUiThread(() -> {
                speedBtn.setEnabled(true);
                if (bestHost[0] == null) {
                    statusText.setText("测速完成：没有可用服务器（先在设置里添加）");
                } else {
                    statusText.setText("测速完成，选择最快: " + bestHost[0] + ":" + bestPort[0] + "（" + bestMs[0] + "ms）");
                    hostInput.setText(bestHost[0]);
                    portInput.setText(String.valueOf(bestPort[0]));
                    saveToken(bestToken[0]);
                    connectLan();
                }
            });
        }).start();
    }

    private boolean pingHost(String host, int port) {
        try (java.net.Socket s = new java.net.Socket()) {
            s.connect(new java.net.InetSocketAddress(host, port), 2000);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ===== 局域网自动发现（mDNS） =====

    private void startAutoDiscovery() {
        statusText.setText("正在自动发现桌面端…");
        discoverBtn.setEnabled(false);
        if (mdnsDiscover != null) mdnsDiscover.stopDiscovery();
        mdnsDiscover = new MDNSDiscover(this);
        mdnsDiscover.setListener(new MDNSDiscover.DiscoveryListener() {
            @Override
            public void onDesktopFound(String host, int port, String name, String token) {
                runOnUiThread(() -> {
                    statusText.setText("发现: " + name + " (" + host + ":" + port + ")");
                    hostInput.setText(host);
                    portInput.setText(String.valueOf(port));
                    discoverBtn.setEnabled(true);
                    saveToken(token);
                    // 自动连接
                    connectLan();
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    statusText.setText("自动发现失败: " + message);
                    discoverBtn.setEnabled(true);
                });
            }
        });
        mdnsDiscover.startDiscovery();

        // 10 秒超时
        new android.os.Handler().postDelayed(() -> {
            if (discoverBtn != null) discoverBtn.setEnabled(true);
            if (statusText.getText().toString().contains("正在自动发现")) {
                statusText.setText("未发现桌面端，请手动输入 IP");
            }
        }, 10000);
    }

    // ===== 远程连接（连接码） =====

    private void connectRemote() {
        String input = codeInput.getText().toString().trim();
        if (input.isEmpty()) { codeInput.setError("请输入连接码"); return; }
        String peerId = normalizePeerId(input);
        prefs.edit().putString("last_code", input).apply();

        remoteBtn.setEnabled(false);
        statusText.setText("连接远程 " + peerId + " …");

        bridgeManager = new P2PBridgeManager(this);
        bridgeManager.connect(peerId, new P2PBridgeManager.Listener() {
            @Override
            public void onDirectConnect(String publicIp, int port, String token) {
                // 桌面端 UPnP 已开公网端口 → 直接连，免 WebRTC
                saveToken(token);
                runOnUiThread(() -> {
                    statusText.setText("UPnP 直连: " + publicIp + ":" + port + " …");
                    connectDirect(publicIp, port);
                });
            }

            @Override
            public void onConnected() {
                runOnUiThread(() -> {
                    statusText.setText("P2P 已连接，启动代理…");
                    LocalProxyServer.startRemote(bridgeManager, new LocalProxyServer.ProxyListener() {
                        @Override
                        public void onStarted(int localPort) {
                            runOnUiThread(() -> openMain("http://127.0.0.1:" + localPort));
                        }

                        @Override
                        public void onError(String message) {
                            runOnUiThread(() -> { statusText.setText("代理失败: " + message); remoteBtn.setEnabled(true); });
                        }
                    });
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> { statusText.setText("远程连接失败: " + message); remoteBtn.setEnabled(true); });
            }
        });
    }

    /** UPnP 直连：走手机代理 → 公网 IP（和局域网一样的流程，带令牌过鉴权门） */
    private void connectDirect(String publicIp, int port) {
        LocalProxyServer.startLan(publicIp, port, new LocalProxyServer.ProxyListener() {
            @Override
            public void onStarted(int localPort) {
                runOnUiThread(() -> openMain("http://127.0.0.1:" + localPort + tokenQuery()));
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> { statusText.setText("直连失败: " + message); remoteBtn.setEnabled(true); });
            }
        });
    }

    // ===== 局域网连接（IP） =====

    private void connectLan() {
        String host = hostInput.getText().toString().trim();
        if (host.isEmpty()) { hostInput.setError("输入IP"); return; }
        String portStr = portInput.getText().toString().trim();
        int port;
        try { port = Integer.parseInt(portStr); } catch (Exception e) { portInput.setError("无效端口"); return; }
        prefs.edit().putString("host", host).putInt("port", port).apply();

        lanBtn.setEnabled(false);
        statusText.setText("启动局域网代理…");
        LocalProxyServer.startLan(host, port, new LocalProxyServer.ProxyListener() {
            @Override
            public void onStarted(int localPort) {
                runOnUiThread(() -> openMain("http://127.0.0.1:" + localPort + tokenQuery()));
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> { statusText.setText("连接失败: " + message); lanBtn.setEnabled(true); });
            }
        });
    }

    // ===== 扫码（带运行时权限申请） =====

    private void openScanner() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                statusText.setText("需要相机权限才能扫码");
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                return;
            }
        }
        startActivityForResult(new Intent(this, QRScannerActivity.class), REQ_SCAN);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startActivityForResult(new Intent(this, QRScannerActivity.class), REQ_SCAN);
            } else {
                statusText.setText("未授予相机权限，无法扫码");
            }
        }
    }

    /** 统一连接码：接受 5V3A / dsh-5V3A，内部补全 */
    private static String normalizePeerId(String input) {
        String s = input.trim().toLowerCase();
        if (s.startsWith("dsh-")) return s;
        return "dsh-" + s;
    }

    private void openMain(String url) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("url", url);
        startActivity(intent);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SCAN && resultCode == RESULT_OK && data != null) {
            String result = data.getStringExtra("SCAN_RESULT");
            if (result != null) {
                // 二维码可能是 http://IP:PORT、dsh-XXXX 或 {"url":"...","peerId":"...","token":"..."}
                if (result.startsWith("http://") || result.startsWith("https://")) {
                    try {
                        java.net.URL url = new java.net.URL(result);
                        hostInput.setText(url.getHost());
                        portInput.setText(String.valueOf(url.getPort() > 0 ? url.getPort() : 3080));
                        // 提取 ?token=（桌面端 LAN 地址可携带令牌）
                        String q = url.getQuery();
                        if (q != null) {
                            for (String pair : q.split("&")) {
                                String[] kv = pair.split("=", 2);
                                if (kv.length == 2 && kv[0].equals("token")) saveToken(kv[1]);
                            }
                        }
                        statusText.setText("扫码成功，填入局域网: " + url.getHost());
                    } catch (Exception e) {
                        hostInput.setText(result);
                    }
                } else if (result.contains("peerId") || result.contains("dsh")) {
                    try {
                        org.json.JSONObject json = new org.json.JSONObject(result);
                        String peerId = json.optString("peerId", "");
                        String lanUrl = json.optString("url", "");
                        String token = json.optString("token", "");
                        if (!lanUrl.isEmpty()) {
                            // 桌面端二维码带局域网地址 + 令牌 → 直接填入并自动连接（扫码即连）
                            try {
                                java.net.URL u = new java.net.URL(lanUrl);
                                hostInput.setText(u.getHost());
                                portInput.setText(String.valueOf(u.getPort() > 0 ? u.getPort() : 3080));
                                saveToken(token);
                                statusText.setText("扫码成功，自动连接: " + u.getHost() + (token.isEmpty() ? "（无令牌，可能需输入连接码）" : ""));
                                connectLan();
                                return;
                            } catch (Exception e2) {
                                hostInput.setText(lanUrl);
                            }
                        }
                        if (!peerId.isEmpty()) {
                            codeInput.setText(peerId.replace("dsh-", ""));
                            statusText.setText("扫码成功，填入连接码: " + peerId.replace("dsh-", ""));
                        }
                    } catch (Exception ignored) {
                        codeInput.setText(result.replace("dsh-", ""));
                        statusText.setText("扫码成功: " + result.replace("dsh-", ""));
                    }
                } else {
                    codeInput.setText(result.replace("dsh-", ""));
                    statusText.setText("扫码成功: " + result.replace("dsh-", ""));
                }
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        LocalProxyServer.stopActive();
        if (bridgeManager != null) bridgeManager.disconnect();
    }
}