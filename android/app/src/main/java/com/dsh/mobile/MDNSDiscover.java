package com.dsh.mobile;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

/**
 * mDNS 服务发现 - 自动发现局域网内的 DSH Desktop
 */
public class MDNSDiscover {

    public interface DiscoveryListener {
        void onDesktopFound(String host, int port, String name);
        void onError(String message);
    }

    private static final String TAG = "MDNS";
    private static final String SERVICE_TYPE = "_dsh._tcp.";

    private final Context context;
    private NsdManager nsdManager;
    private NsdManager.DiscoveryListener discoveryListener;
    private NsdManager.ResolveListener resolveListener;
    private DiscoveryListener listener;
    private boolean discovering = false;

    public MDNSDiscover(Context context) {
        this.context = context;
        try {
            this.nsdManager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        } catch (Exception e) {
            Log.e(TAG, "无法获取 NsdManager: " + e.getMessage());
            this.nsdManager = null;
        }
    }

    public void setListener(DiscoveryListener listener) {
        this.listener = listener;
    }

    /** 开始发现桌面端 */
    public void startDiscovery() {
        if (discovering) return;
        if (nsdManager == null) {
            if (listener != null) listener.onError("设备不支持 mDNS 发现");
            return;
        }
        discovering = true;

        resolveListener = new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Log.e(TAG, "解析失败: " + errorCode);
            }

            @Override
            public void onServiceResolved(NsdServiceInfo serviceInfo) {
                String host = serviceInfo.getHost().getHostAddress();
                int port = serviceInfo.getPort();
                String name = serviceInfo.getServiceName();
                Log.d(TAG, "发现: " + name + " at " + host + ":" + port);
                if (listener != null) {
                    listener.onDesktopFound(host, port, name);
                }
            }
        };

        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String regType) {
                Log.d(TAG, "开始发现: " + regType);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                String type = serviceInfo.getServiceType();
                if (type != null && type.equals(SERVICE_TYPE)) {
                    try { nsdManager.resolveService(serviceInfo, resolveListener); } catch (Exception ignored) {}
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                Log.d(TAG, "服务丢失: " + serviceInfo.getServiceName());
            }

            @Override
            public void onDiscoveryStopped(String regType) {
                discovering = false;
            }

            @Override
            public void onStartDiscoveryFailed(String regType, int errorCode) {
                discovering = false;
                if (listener != null) listener.onError("发现失败: " + errorCode);
            }

            @Override
            public void onStopDiscoveryFailed(String regType, int errorCode) {
                discovering = false;
            }
        };

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception e) {
            discovering = false;
            if (listener != null) listener.onError("启动发现异常: " + e.getMessage());
        }
    }

    /** 停止发现 */
    public void stopDiscovery() {
        if (nsdManager != null && discoveryListener != null && discovering) {
            try { nsdManager.stopServiceDiscovery(discoveryListener); } catch (Exception ignored) {}
        }
        discovering = false;
    }
}