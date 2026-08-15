package com.dsh.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private LinearLayout connectionBar;
    private TextView connectionStatusText;
    private String currentUrl;
    private int reconnectAttempts = 0;

    /**
     * 移动端注入: crypto.randomUUID polyfill（纯 HTTP 局域网来源没有 secure context，参考 dsh-web-lan-access, MIT）
     * + 触屏移动 CSS（参考 dsh-web-mobile / dsh-mobile-css 思路, MIT）。
     */
    private static final String MOBILE_CSS =
            "html,body{max-width:100vw;overflow-x:hidden}" +
            "input,textarea,button,select,label,summary{min-height:44px;font-size:16px}" +
            "main{width:100%!important;max-width:100vw!important}";

    private static final String MOBILE_INJECT =
            "(function(){"
            + "if(!window.crypto){window.crypto={};}"
            + "if(!window.crypto.randomUUID){window.crypto.randomUUID=function(){"
            + "function rnd(n){var b=new Uint8Array(n);if(window.crypto.getRandomValues){window.crypto.getRandomValues(b);}"
            + "else{for(var i=0;i<n;i++){b[i]=Math.floor(Math.random()*256);}}return b;}"
            + "var b=rnd(16);b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;"
            + "function h(x){return(x<16?'0':'')+x.toString(16);}"
            + "return h(b[0])+h(b[1])+h(b[2])+h(b[3])+'-'+h(b[4])+h(b[5])+'-'+h(b[6])+h(b[7])+'-'+h(b[8])+h(b[9])+'-'+h(b[10])+h(b[11])+h(b[12])+h(b[13])+h(b[14])+h(b[15]);"
            + "};}"
            + "var s=document.createElement('style');s.textContent='" + MOBILE_CSS + "';"
            + "document.head.appendChild(s);"
            + "})();";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        connectionBar = findViewById(R.id.connection_bar);
        connectionStatusText = findViewById(R.id.connection_status_text);
        ImageButton menuButton = findViewById(R.id.menu_button);

        Intent intent = getIntent();
        String url = intent.getStringExtra("url");
        String proxyUrl = intent.getStringExtra("proxy_url");

        if (proxyUrl != null) {
            currentUrl = proxyUrl;
        } else if (url != null) {
            currentUrl = url;
        } else {
            currentUrl = "http://127.0.0.1:3080";
        }

        menuButton.setOnClickListener(v -> showMenu(v));
        setupWebView();

        showConnectionStatus("Connecting to " + currentUrl, "#00BFA5");
        connectionBar.setVisibility(View.VISIBLE);
        webView.loadUrl(currentUrl);
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            settings.setForceDark(WebSettings.FORCE_DARK_AUTO);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                showConnectionStatus("Loading…", "#00BFA5");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                reconnectAttempts = 0;
                // 注入 polyfill + 移动端 CSS（randomUUID 对纯 HTTP 来源必需）
                view.evaluateJavascript("javascript:" + MOBILE_INJECT, null);
                showConnectionStatus("Connected", "#00BFA5");
                hideConnectionBarAfterDelay(2000);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode,
                    String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                // 网络类错误自动重连（最多 3 次，间隔 2 秒）
                boolean networkError = errorCode == WebViewClient.ERROR_HOST_LOOKUP
                        || errorCode == WebViewClient.ERROR_CONNECT
                        || errorCode == WebViewClient.ERROR_TIMEOUT
                        || errorCode == WebViewClient.ERROR_IO
                        || errorCode == WebViewClient.ERROR_UNKNOWN;
                if (networkError && reconnectAttempts < 3 && currentUrl != null) {
                    reconnectAttempts++;
                    showConnectionStatus("连接中断，自动重连 (" + reconnectAttempts + "/3)…", "#FF9800");
                    String retry = currentUrl;
                    view.postDelayed(() -> view.loadUrl(retry), 2000);
                } else {
                    showConnectionStatus("Error: " + description, "#B3261E");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    if (!url.contains("127.0.0.1") && !url.contains(currentUrl)) {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    }
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    showConnectionStatus("Loading " + newProgress + "%", "#00BFA5");
                }
            }
        });

        webView.addJavascriptInterface(new WebAppInterface(this), "DSHMobile");
    }

    private void showMenu(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        popup.getMenu().add(0, 1, 0, "Reload");
        popup.getMenu().add(0, 2, 0, "New Connection");
        popup.getMenu().add(0, 3, 0, "Open in Browser");
        popup.getMenu().add(0, 4, 0, "Disconnect");

        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: webView.reload(); return true;
                case 2:
                    startActivity(new Intent(this, ConnectActivity.class));
                    finish();
                    return true;
                case 3:
                    String url = webView.getUrl();
                    if (url != null && !url.equals("about:blank")) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } else {
                        Toast.makeText(this, "Not connected", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                case 4:
                    webView.stopLoading();
                    webView.loadUrl("about:blank");
                    showConnectionStatus("Disconnected", "#B3261E");
                    connectionBar.setVisibility(View.VISIBLE);
                    return true;
                default: return false;
            }
        });
        popup.show();
    }

    private void showConnectionStatus(String text, String colorHex) {
        connectionStatusText.setText(text);
        connectionBar.setBackgroundColor(android.graphics.Color.parseColor(colorHex));
        connectionBar.setVisibility(View.VISIBLE);
    }

    private void hideConnectionBarAfterDelay(long delayMs) {
        webView.postDelayed(() -> connectionBar.setVisibility(View.GONE), delayMs);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() { super.onResume(); webView.onResume(); }
    @Override
    protected void onPause() { webView.onPause(); super.onPause(); }
    @Override
    protected void onDestroy() {
        webView.destroy();
        // 退出时停掉本地代理
        LocalProxyServer.stopActive();
        super.onDestroy();
    }
}