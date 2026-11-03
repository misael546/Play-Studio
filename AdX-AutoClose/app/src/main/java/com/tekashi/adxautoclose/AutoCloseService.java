package com.tekashi.adxautoclose;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.TextView;
import java.util.Locale;

public class AutoCloseService extends AccessibilityService {
    private WindowManager wm;
    private TextView bubble;
    private WindowManager.LayoutParams params;
    private boolean active = false;
    private String selectedPackage = "";
    private String currentPackage = "";
    private long lastClick = 0;
    private float downRawX, downRawY, lastRawX, lastRawY;
    private boolean dragging = false;
    private int touchSlop;

    @Override protected void onServiceConnected() {
        AccessibilityServiceInfo info = getServiceInfo();
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                | AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                | AccessibilityEvent.TYPE_WINDOWS_CHANGED;
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        info.flags = AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        info.notificationTimeout = 120;
        setServiceInfo(info);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        showBubble();
    }

    private void showBubble() {
        if (bubble != null) return;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        bubble = new TextView(this);
        bubble.setText("ADX: ELEGIR");
        bubble.setTextColor(0xffffffff);
        bubble.setTextSize(12);
        bubble.setPadding(22, 14, 22, 14);
        bubble.setBackgroundColor(0xff673ab7);
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.END;
        params.x = 24;
        params.y = 240;
        bubble.setOnTouchListener((view, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downRawX = lastRawX = event.getRawX();
                    downRawY = lastRawY = event.getRawY();
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - downRawX;
                    float dy = event.getRawY() - downRawY;
                    if (Math.hypot(dx, dy) > touchSlop) dragging = true;
                    if (dragging) {
                        params.x -= Math.round(event.getRawX() - lastRawX);
                        params.y += Math.round(event.getRawY() - lastRawY);
                        try { wm.updateViewLayout(bubble, params); } catch (Exception ignored) {}
                    }
                    lastRawX = event.getRawX();
                    lastRawY = event.getRawY();
                    return true;
                case MotionEvent.ACTION_UP:
                    if (dragging) return true;
                    if (event.getEventTime() - event.getDownTime() >= 650) {
                        if (!currentPackage.isEmpty() && !currentPackage.equals(getPackageName())) {
                            selectedPackage = currentPackage;
                            active = false;
                            bubble.setText("ADX: JUEGO OK");
                        }
                    } else {
                        active = !active;
                        bubble.setText(active ? "ADX: ACTIVO" : "ADX: PAUSADO");
                        if (active && selectedPackage.isEmpty()) bubble.setText("ADX: ELIGE JUEGO");
                    }
                    return true;
                default:
                    return true;
            }
        });
        try { wm.addView(bubble, params); } catch (Exception ignored) {}
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        CharSequence packageName = event.getPackageName();
        if (packageName != null) {
            String pkg = packageName.toString();
            if (!pkg.equals(getPackageName())) currentPackage = pkg;
        }
        if (!active || selectedPackage.isEmpty()
                || !selectedPackage.equals(currentPackage)
                || System.currentTimeMillis() - lastClick < 1400) return;

        // Prefer the active root, then inspect other interactive windows (dialogs/overlays).
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root != null) {
            try {
                if (walk(root, 0)) return;
            } finally { root.recycle(); }
        }
        if (Build.VERSION.SDK_INT >= 21) {
            try {
                for (AccessibilityWindowInfo window : getWindows()) {
                    AccessibilityNodeInfo windowRoot = window.getRoot();
                    if (windowRoot != null) {
                        try { if (walk(windowRoot, 0)) return; }
                        finally { windowRoot.recycle(); }
                    }
                }
            } catch (Exception ignored) {}
        }
    }

    private boolean walk(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 18) return false;
        CharSequence text = node.getText();
        CharSequence description = node.getContentDescription();
        String label = normalize((text == null ? "" : text.toString()) + " "
                + (description == null ? "" : description.toString()));
        if (isExplicitClose(label) && node.isVisibleToUser() && node.isEnabled()) {
            AccessibilityNodeInfo target = findClickable(node);
            if (target != null) {
                boolean clicked = target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                target.recycle();
                if (clicked) {
                    lastClick = System.currentTimeMillis();
                    return true;
                }
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                boolean done = walk(child, depth + 1);
                child.recycle();
                if (done) return true;
            }
        }
        return false;
    }

    private String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private boolean isExplicitClose(String value) {
        if (value.isEmpty() || value.length() > 32
                || value.contains("skip") || value.contains("omitir")
                || value.contains("next") || value.contains("siguiente")
                || value.contains("continue") || value.contains("continuar")) return false;
        return value.equals("close") || value.equals("cerrar")
                || value.equals("dismiss") || value.equals("close ad")
                || value.equals("close ads") || value.equals("cerrar anuncio")
                || value.equals("cerrar anuncios") || value.equals("×")
                || value.equals("✕") || value.equals("✖") || value.equals("✗");
    }

    private AccessibilityNodeInfo findClickable(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = AccessibilityNodeInfo.obtain(node);
        for (int i = 0; i < 6 && current != null; i++) {
            if (current.isClickable() && current.isEnabled() && current.isVisibleToUser()) return current;
            AccessibilityNodeInfo parent = current.getParent();
            current.recycle();
            current = parent;
        }
        if (current != null) current.recycle();
        return null;
    }

    @Override public void onInterrupt() { active = false; }
    @Override public void onDestroy() {
        active = false;
        if (wm != null && bubble != null) {
            try { wm.removeView(bubble); } catch (Exception ignored) {}
        }
        bubble = null;
        super.onDestroy();
    }
}