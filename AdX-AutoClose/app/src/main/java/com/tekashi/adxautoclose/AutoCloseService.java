package com.tekashi.adxautoclose;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import java.util.Locale;

public class AutoCloseService extends AccessibilityService {
    private WindowManager wm; private TextView bubble; private boolean active=false; private String selectedPackage=""; private long lastClick=0; private float downX,downY; private WindowManager.LayoutParams params;
    @Override protected void onServiceConnected() {
        AccessibilityServiceInfo i=getServiceInfo(); i.eventTypes=AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED|AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED|AccessibilityEvent.TYPE_WINDOWS_CHANGED; i.feedbackType=AccessibilityServiceInfo.FEEDBACK_GENERIC; i.flags=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS|AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS; i.notificationTimeout=120; setServiceInfo(i); showBubble();
    }
    private void showBubble(){ if (bubble!=null) return; wm=(WindowManager)getSystemService(WINDOW_SERVICE); bubble=new TextView(this); bubble.setText("ADX: ELEGIR"); bubble.setTextColor(0xffffffff); bubble.setTextSize(12); bubble.setPadding(22,14,22,14); bubble.setBackgroundColor(0xff673ab7); int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE; params=new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.WRAP_CONTENT,type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT); params.gravity=Gravity.TOP|Gravity.END; params.x=24; params.y=240; bubble.setOnTouchListener((v,e)->{ if(e.getAction()==MotionEvent.ACTION_DOWN){downX=e.getRawX();downY=e.getRawY();return true;} if(e.getAction()==MotionEvent.ACTION_MOVE){params.x+= (int)(downX-e.getRawX());params.y+=(int)(e.getRawY()-downY);downX=e.getRawX();downY=e.getRawY();wm.updateViewLayout(bubble,params);return true;} if(e.getAction()==MotionEvent.ACTION_UP){ if(Math.abs(e.getRawX()-downX)<8 && Math.abs(e.getRawY()-downY)<8){active=!active;bubble.setText(active?"ADX: ACTIVO":"ADX: PAUSADO");} return true;} return true;}); try{wm.addView(bubble,params);}catch(Exception ignored){} }
    @Override public void onAccessibilityEvent(AccessibilityEvent event){ if(!active||event==null)return; CharSequence p=event.getPackageName(); if(p==null)return; String pkg=p.toString(); if(pkg.equals(getPackageName()))return; if(selectedPackage.isEmpty()){selectedPackage=pkg; if(bubble!=null)bubble.setText("ADX: JUEGO OK"); return;} if(!selectedPackage.equals(pkg))return; if(System.currentTimeMillis()-lastClick<1800)return; AccessibilityNodeInfo root=getRootInActiveWindow(); if(root==null)return; try{walk(root,0);}finally{root.recycle();} }
    private boolean walk(AccessibilityNodeInfo node,int depth){ if(node==null||depth>14)return false; CharSequence t=node.getText(),d=node.getContentDescription(); String s=((t==null?"":t.toString())+" "+(d==null?"":d.toString())).trim().toLowerCase(Locale.ROOT); if(isExplicitClose(s)&&node.isVisibleToUser()&&node.isEnabled()){ AccessibilityNodeInfo target=findClickable(node); if(target!=null){ boolean ok=target.performAction(AccessibilityNodeInfo.ACTION_CLICK); target.recycle(); if(ok){lastClick=System.currentTimeMillis();return true;} } }
        for(int n=0;n<node.getChildCount();n++){AccessibilityNodeInfo c=node.getChild(n); if(c!=null){boolean done=walk(c,depth+1);c.recycle();if(done)return true;}} return false; }
    private boolean isExplicitClose(String s){ if(s.isEmpty()||s.length()>28||s.contains("skip")||s.contains("omitir")||s.contains("next")||s.contains("siguiente"))return false; return s.equals("close")||s.equals("cerrar")||s.equals("dismiss")||s.equals("close ad")||s.equals("close ads")||s.equals("cerrar anuncio")||s.equals("cerrar anuncios")||s.equals("×")||s.equals("✕")||s.equals("✖")||s.equals("✗"); }
    private AccessibilityNodeInfo findClickable(AccessibilityNodeInfo n){ AccessibilityNodeInfo cur=AccessibilityNodeInfo.obtain(n); for(int i=0;i<5&&cur!=null;i++){if(cur.isClickable())return cur; AccessibilityNodeInfo par=cur.getParent();cur.recycle();cur=par;} if(cur!=null)cur.recycle();return null; }
    @Override public void onInterrupt(){}
    @Override public void onDestroy(){if(wm!=null&&bubble!=null)try{wm.removeView(bubble);}catch(Exception ignored){} bubble=null;super.onDestroy();}
}
