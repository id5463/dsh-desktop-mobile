package com.dshd.blue;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.Handler;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.widget.Button;
import android.widget.TextView;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.util.HashMap;
import java.util.Map;

/**
 * 内置二维码扫描器：预览帧连续扫描（与主流扫码 App 相同原理），
 * 解码速度比拍照方式快且稳。
 */
public class QRScannerActivity extends Activity implements SurfaceHolder.Callback {

    private SurfaceView previewView;
    private TextView statusText;
    private Camera camera;
    private volatile boolean scanning = true;
    private final Handler handler = new Handler();
    private final MultiFormatReader reader = new MultiFormatReader();
    private Camera.PreviewCallback previewCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_qr_scanner);

        previewView = findViewById(R.id.scanner_preview);
        statusText = findViewById(R.id.scanner_status);
        Button cancelBtn = findViewById(R.id.btn_cancel);

        // 初始化解码器：只要二维码，TRY_HARDER 提高成功率
        Map<DecodeHintType, Object> hints = new HashMap<>();
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        reader.setHints(hints);

        previewView.getHolder().addCallback(this);
        cancelBtn.setOnClickListener(v -> finish());
    }

    // ===== SurfaceHolder.Callback =====

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        try {
            camera = Camera.open();
            camera.setPreviewDisplay(holder);
            // 竖屏方向修正
            camera.setDisplayOrientation(90);

            Camera.Parameters params = camera.getParameters();
            Camera.Size size = pickPreviewSize(params);
            if (size != null) params.setPreviewSize(size.width, size.height);
            if (params.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                params.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            }
            camera.setParameters(params);

            // 预览帧回调：每帧都尝试解码
            previewCallback = (data, cam) -> {
                if (!scanning || cam == null) return;
                Camera.Size s = cam.getParameters().getPreviewSize();
                if (s == null) return;
                // 缩放解码：把预览帧缩到目标宽度，速度与内存都友好
                final int targetW = 640;
                final int targetH = (int) ((long) s.height * targetW / s.width);
                byte[] rgb = yuvToRgb(data, s.width, s.height, targetW, targetH);
                String result = decodeRgb(rgb, targetW, targetH);
                if (result != null) {
                    scanning = false;
                    statusText.setText("识别成功");
                    Intent intent = new Intent();
                    intent.putExtra("SCAN_RESULT", result);
                    setResult(RESULT_OK, intent);
                    finish();
                }
            };
            camera.setPreviewCallback(previewCallback);
            camera.startPreview();
            statusText.setText("对准二维码");
        } catch (Exception e) {
            statusText.setText("无法打开相机: " + e.getMessage());
        }
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        // 忽略
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        releaseCamera();
    }

    /** 选一个 4:3 左右的预览尺寸，避免畸变 */
    private Camera.Size pickPreviewSize(Camera.Parameters params) {
        try {
            Camera.Size best = null;
            double bestDiff = Double.MAX_VALUE;
            for (Camera.Size s : params.getSupportedPreviewSizes()) {
                double ratio = (double) s.width / s.height;
                double diff = Math.abs(ratio - 4.0 / 3.0);
                if (diff < bestDiff) { bestDiff = diff; best = s; }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * NV21 → RGB 并缩放到目标尺寸。
     * 相机预览默认 YUV420sp(NV21)，逐行采样缩小。
     */
    private byte[] yuvToRgb(byte[] nv21, int srcW, int srcH, int dstW, int dstH) {
        byte[] rgb = new byte[dstW * dstH * 3];
        int srcIndex;
        int dstIndex = 0;
        for (int y = 0; y < dstH; y++) {
            int srcY = y * srcH / dstH;
            int rowOffset = srcY * srcW;
            int vuvOffset = srcH * srcW;
            for (int x = 0; x < dstW; x++) {
                int srcX = x * srcW / dstW;
                srcIndex = rowOffset + srcX;
                int Y = nv21[srcIndex] & 0xff;
                int V = nv21[vuvOffset + (srcY >> 1) * srcW + (srcX & ~1) + 1] & 0xff;
                int U = nv21[vuvOffset + (srcY >> 1) * srcW + (srcX & ~1)] & 0xff;
                int r = (int) (Y + 1.402 * (V - 128));
                int g = (int) (Y - 0.34414 * (U - 128) - 0.71414 * (V - 128));
                int b = (int) (Y + 1.772 * (U - 128));
                rgb[dstIndex++] = clamp(r);
                rgb[dstIndex++] = clamp(g);
                rgb[dstIndex++] = clamp(b);
            }
        }
        return rgb;
    }

    private static byte clamp(int v) {
        return (byte) (v < 0 ? 0 : (v > 255 ? 255 : v));
    }

    /** 用 zxing 解码 RGB 数据（byte[] → int[] ARGB） */
    private String decodeRgb(byte[] rgb, int w, int h) {
        try {
            int[] pixels = new int[w * h];
            for (int i = 0, j = 0; i < w * h; i++, j += 3) {
                pixels[i] = (0xFF << 24) | ((rgb[j] & 0xFF) << 16) | ((rgb[j + 1] & 0xFF) << 8) | (rgb[j + 2] & 0xFF);
            }
            LuminanceSource source = new RGBLuminanceSource(w, h, pixels);
            BinaryBitmap binary = new BinaryBitmap(new HybridBinarizer(source));
            Result result = reader.decodeWithState(binary);
            reader.reset();
            return result != null ? result.getText() : null;
        } catch (Exception e) {
            reader.reset();
            return null;
        }
    }

    private void releaseCamera() {
        if (camera != null) {
            try { camera.setPreviewCallback(null); } catch (Exception ignored) {}
            try { camera.stopPreview(); } catch (Exception ignored) {}
            try { camera.release(); } catch (Exception ignored) {}
            camera = null;
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        scanning = false;
        releaseCamera();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        scanning = false;
        releaseCamera();
        handler.removeCallbacksAndMessages(null);
    }
}