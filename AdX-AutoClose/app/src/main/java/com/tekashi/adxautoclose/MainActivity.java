package com.tekashi.adxautoclose;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private int dp(float v) { return (int)(v * getResources().getDisplayMetrics().density + .5f); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this); root.setOrientation(1); root.setPadding(dp(24),dp(28),dp(24),dp(24)); root.setBackgroundColor(0xff101522);
        TextView title = new TextView(this); title.setText("AdX AutoClose"); title.setTextColor(0xffffffff); title.setTextSize(27); title.setGravity(Gravity.CENTER); root.addView(title);
        TextView info = new TextView(this); info.setText("Asistente para cerrar controles de anuncios visibles. No abre anuncios ni automatiza recompensas.\n\nLa detección visual completa requiere permiso de captura de pantalla y calibración; esta versión inicial solo actúa sobre controles expuestos por Android Accessibility."); info.setTextColor(0xffcbd5e1); info.setTextSize(15); info.setPadding(0,dp(18),0,dp(22)); root.addView(info);
        Button access = new Button(this); access.setText("Activar servicio de accesibilidad"); access.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))); root.addView(access);
        Button overlay = new Button(this); overlay.setText("Permitir botón flotante"); overlay.setOnClickListener(v -> { if (!Settings.canDrawOverlays(this)) startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:"+getPackageName()))); }); root.addView(overlay);
        TextView note = new TextView(this); note.setText("Uso: vuelve al juego, mantén pulsado el botón ADX para seleccionar la app y toca una vez para activar/pausar.\n\nLa app no debe pulsar flechas o controles ambiguos: un icono gráfico no se considera un botón de cierre sin verificación."); note.setTextColor(0xff94a3b8); note.setTextSize(13); note.setPadding(0,dp(20),0,0); root.addView(note);
        setContentView(root);
    }
}
