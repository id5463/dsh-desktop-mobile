package com.dsh.mobile;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 设置页：默认主机 + 多服务器列表（供测速自动选择，参考 dsh-Remote, MIT）。
 */
public class SettingsActivity extends Activity {

    private static final String PREFS_NAME = "dsh_mobile_prefs";
    private static final String KEY_HOST = "host";
    private static final String KEY_PORT = "port";
    private static final String KEY_SERVERS = "servers";

    private EditText hostInput, portInput, tokenInput;
    private Button saveButton, addServerButton, clearServersButton;
    private TextView serversList;
    private SharedPreferences preferences;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        setTitle("Settings");

        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        hostInput = findViewById(R.id.host_input);
        portInput = findViewById(R.id.port_input);
        tokenInput = findViewById(R.id.token_input);
        saveButton = findViewById(R.id.save_button);
        addServerButton = findViewById(R.id.add_server_button);
        clearServersButton = findViewById(R.id.clear_servers_button);
        serversList = findViewById(R.id.servers_list);

        String savedHost = preferences.getString(KEY_HOST, "127.0.0.1");
        int savedPort = preferences.getInt(KEY_PORT, 3080);
        hostInput.setText(savedHost);
        portInput.setText(String.valueOf(savedPort));
        refreshList();

        saveButton.setOnClickListener(v -> saveSettings());
        addServerButton.setOnClickListener(v -> addServer());
        clearServersButton.setOnClickListener(v -> {
            preferences.edit().putString(KEY_SERVERS, "[]").apply();
            refreshList();
            Toast.makeText(this, "服务器列表已清空", Toast.LENGTH_SHORT).show();
        });
    }

    private void refreshList() {
        try {
            JSONArray arr = new JSONArray(preferences.getString(KEY_SERVERS, "[]"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject s = arr.getJSONObject(i);
                String token = s.optString("token", "");
                sb.append(i + 1).append(". ").append(s.optString("host", "?"))
                        .append(":").append(s.optInt("port", 3080))
                        .append(token.isEmpty() ? "" : " (token)")
                        .append("\n");
            }
            serversList.setText(sb.length() == 0 ? "（空）" : sb.toString().trim());
        } catch (Exception e) {
            serversList.setText("（解析失败）");
        }
    }

    private void saveSettings() {
        String host = hostInput.getText().toString().trim();
        String portStr = portInput.getText().toString().trim();

        if (host.isEmpty()) {
            hostInput.setError("Host cannot be empty");
            return;
        }

        int port;
        try {
            port = Integer.parseInt(portStr);
            if (port < 1 || port > 65535) {
                portInput.setError("Port must be between 1 and 65535");
                return;
            }
        } catch (NumberFormatException e) {
            portInput.setError("Invalid port number");
            return;
        }

        preferences.edit()
                .putString(KEY_HOST, host)
                .putInt(KEY_PORT, port)
                .apply();

        Toast.makeText(this, "Settings saved. Please reconnect.", Toast.LENGTH_SHORT).show();
        finish();
    }

    /** 多服务器：把当前 host/port/token 追加到列表（供测速自动选择） */
    private void addServer() {
        String host = hostInput.getText().toString().trim();
        if (host.isEmpty()) {
            hostInput.setError("Host cannot be empty");
            return;
        }
        int port;
        try {
            port = Integer.parseInt(portInput.getText().toString().trim());
        } catch (Exception e) {
            portInput.setError("Invalid port");
            return;
        }
        String token = tokenInput.getText().toString().trim();
        try {
            JSONArray arr = new JSONArray(preferences.getString(KEY_SERVERS, "[]"));
            JSONObject s = new JSONObject();
            s.put("host", host);
            s.put("port", port);
            s.put("token", token);
            arr.put(s);
            preferences.edit().putString(KEY_SERVERS, arr.toString()).apply();
            refreshList();
            Toast.makeText(this, "已添加: " + host + ":" + port, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "添加失败: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }
}
