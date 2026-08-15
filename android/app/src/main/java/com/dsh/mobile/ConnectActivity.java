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
    private Button remoteBtn, lanBtn, scanBtn, discoverBtn;
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
        statusText = findViewById(R.id.status_text);

        codeInput.setText(prefs.getString("last_code", ""));
        hostInput.setText(prefs.getString("host", "192.168.0.112"));
        portInput.setText(String.valueOf(prefs.getInt("port", 3080)));

        remoteBtn.setOnClickListener(v -> connectRemote());
        lanBtn.setOnClickListener(v -> connectLan());
        scanBtn.setOnClickListener(v -> openScanner());
        discoverBtn.setOnClickListener(v -> startAutoDiscovery());
    }

    // ===== 局域网自动发现（mDNS） =====

    private void startAutoDiscovery() {
        statusText.setText("正在自动发现桌面端…");
        discoverBtn.setEnabled(false);
        if (mdnsDiscover != null) mdnsDiscover.stopDiscovery();
        mdnsDiscover = new MDNSDiscover(this);
        mdnsDiscover.setListener(new MDNSDiscover.DiscoveryListener() {
            @Override
            public void onDesktopFound(String host, int port, String name) {
                runOnUiThread(() -> {
                    statusText.setText("发现: " + name + " (" + host + ":" + port + ")");
                    hostInput.setText(host);
                    portInput.setText(String.valueOf(port));
                    discoverBtn.setEnabled(true);
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
            public void onDirectConnect(String publicIp, int port) {
                // 桌面端 UPnP 已开公网端口 → 直接连，免 WebRTC
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

    /** UPnP 直连：走手机代理 → 公网 IP（和局域网一样的流程） */
    private void connectDirect(String publicIp, int port) {
        LocalProxyServer.startLan(publicIp, port, new LocalProxyServer.ProxyListener() {
            @Override
            public void onStarted(int localPort) {
                runOnUiThread(() -> openMain("http://127.0.0.1:" + localPort));
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
                runOnUiThread(() -> openMain("http://127.0.0.1:" + localPort));
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
                // 二维码可能是 http://IP:PORT、dsh-XXXX 或 {"url":"...","peerId":"..."}
                if (result.startsWith("http://") || result.startsWith("https://")) {
                    try {
                        java.net.URL url = new java.net.URL(result);
                        hostInput.setText(url.getHost());
                        portInput.setText(String.valueOf(url.getPort() > 0 ? url.getPort() : 3080));
                        statusText.setText("扫码成功，填入局域网: " + url.getHost());
                    } catch (Exception e) {
                        hostInput.setText(result);
                    }
                } else if (result.contains("peerId") || result.contains("dsh")) {
                    try {
                        org.json.JSONObject json = new org.json.JSONObject(result);
                        String peerId = json.optString("peerId", "");
                        if (!peerId.isEmpty()) {
                            codeInput.setText(peerId.replace("dsh-", ""));
                            statusText.setText("扫码成功，填入连接码: " + peerId.replace("dsh-", ""));
                        }
                    } catch (Exception ignored) {
                        codeInput.setText(result.replace("dsh-", ""));
                        statusText.setText("扫码成功，填入连接码: " + result.replace("dsh-", ""));
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