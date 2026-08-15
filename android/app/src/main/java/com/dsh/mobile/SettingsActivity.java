package com.dsh.mobile;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

public class SettingsActivity extends Activity {

    private EditText hostInput;
    private EditText portInput;
    private Button saveButton;
    private SharedPreferences preferences;

    private static final String PREFS_NAME = "dsh_mobile_prefs";
    private static final String KEY_HOST = "host";
    private static final String KEY_PORT = "port";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        setTitle("Settings");

        preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        hostInput = findViewById(R.id.host_input);
        portInput = findViewById(R.id.port_input);
        saveButton = findViewById(R.id.save_button);

        String savedHost = preferences.getString(KEY_HOST, "127.0.0.1");
        int savedPort = preferences.getInt(KEY_PORT, 3080);
        hostInput.setText(savedHost);
        portInput.setText(String.valueOf(savedPort));

        saveButton.setOnClickListener(v -> saveSettings());
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
}