package com.dsh.mobile;

/**
 * Manages connection state to the DSH server.
 */
public class ConnectionManager {

    private String host;
    private int port;
    private boolean connected;

    public ConnectionManager() {
        this.host = "127.0.0.1";
        this.port = 3080;
        this.connected = false;
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }

    public boolean isConnected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }

    public String getBaseUrl() {
        return "http://" + host + ":" + port;
    }
}