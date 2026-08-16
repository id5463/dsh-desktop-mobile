package com.dshd.blue;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

/**
 * JavaScript interface exposed to the WebView as `DSHMobile`.
 * Allows the DSH web UI to interact with native Android features.
 */
public class WebAppInterface {

    private final Context context;

    public WebAppInterface(Context context) {
        this.context = context;
    }

    /**
     * Show a toast message from the web UI.
     */
    @JavascriptInterface
    public void showToast(String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }

    /**
     * Get the device info string for the web UI.
     */
    @JavascriptInterface
    public String getDeviceInfo() {
        return "Android " + android.os.Build.VERSION.RELEASE
                + " (" + android.os.Build.MODEL + ")";
    }

    /**
     * Open a URL in the system browser.
     */
    @JavascriptInterface
    public void openInBrowser(String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        context.startActivity(intent);
    }

    /**
     * Check if the app is running in standalone mode (not PWA).
     */
    @JavascriptInterface
    public boolean isNativeApp() {
        return true;
    }

    /**
     * Get the current connection status.
     */
    @JavascriptInterface
    public String getConnectionStatus() {
        return "connected";
    }
}