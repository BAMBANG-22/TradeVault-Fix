package com.tradevault.journal;

import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    private static final String PREFS_NAME = "TradeVaultSystemBarsPrefs";
    private static final String KEY_THEME = "active_theme";

    // Dark Mode colors matching Navbar (#050607) and MobileNav (#0B0D11)
    private static final int DARK_TOP_BAR_COLOR = Color.parseColor("#050607");
    private static final int DARK_BOTTOM_BAR_COLOR = Color.parseColor("#0B0D11");

    // Light Mode colors matching Navbar (#FFFFFF) and MobileNav (#FFFFFF)
    private static final int LIGHT_TOP_BAR_COLOR = Color.parseColor("#FFFFFF");
    private static final int LIGHT_BOTTOM_BAR_COLOR = Color.parseColor("#FFFFFF");

    private String currentAppTheme = "dark";
    private SplitSystemBarsDrawable activeBarsDrawable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafExportPlugin.class);
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        currentAppTheme = prefs.getString(KEY_THEME, "dark");

        configureBoundedSeamlessSystemBars();
        attachThemeJavascriptBridge();
        applySystemBarThemeColors(currentAppTheme);
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBarThemeColors(currentAppTheme);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Re-assert TradeVault's in-app theme colors and system bar insets across portrait/landscape transitions
        applySystemBarThemeColors(currentAppTheme);
        if (getWindow() != null && getWindow().getDecorView() != null) {
            ViewCompat.requestApplyInsets(getWindow().getDecorView());
        }
    }

    /**
     * Keeps the WebView (main UI) strictly bounded below the Status Bar and above the Navigation Bar
     * (so UI content never overlaps the clock/battery or bottom phone nav buttons), while allowing
     * the DecorView background to fill the status bar cutout and navigation bar regions with the exact
     * same color as TradeVault's active theme.
     */
    private void configureBoundedSeamlessSystemBars() {
        final Window window = getWindow();
        if (window == null) return;

        // Allow DecorView to color the full screen including camera cutout/notch region
        WindowCompat.setDecorFitsSystemWindows(window, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            } else {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            window.setAttributes(lp);
        }

        final View decorView = window.getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            Insets systemBarsInsets = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());

            int bottomPadding = keyboardVisible ? imeInsets.bottom : systemBarsInsets.bottom;

            // Pad the DecorView so the WebView starts cleanly below the status bar and ends above the nav bar
            v.setPadding(
                systemBarsInsets.left,
                systemBarsInsets.top,
                systemBarsInsets.right,
                bottomPadding
            );

            // Consume systemBar/cutout insets so the WebView does not double-pad internally
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, 0)
                )
                .build();
        });

        // Guard against Capacitor's built-in SystemBars plugin overwriting DecorView background on main thread
        decorView.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                if (activeBarsDrawable != null && decorView.getBackground() != activeBarsDrawable) {
                    decorView.setBackground(activeBarsDrawable);
                    enforceSystemBarAppearance("light".equalsIgnoreCase(currentAppTheme));
                }
                return true;
            }
        });

        ViewCompat.requestApplyInsets(decorView);
    }

    private void attachThemeJavascriptBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        final WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(
            "light".equalsIgnoreCase(currentAppTheme) ? LIGHT_TOP_BAR_COLOR : DARK_TOP_BAR_COLOR
        );
        webView.addJavascriptInterface(new SystemBarsThemeBridge(), "TradeVaultSystemBars");

        // Automatically read persisted theme from WebView localStorage on page commit/finish
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                queryThemeFromWebView(view);
            }

            @Override
            public void onPageLoaded(WebView view) {
                super.onPageLoaded(view);
                queryThemeFromWebView(view);
            }
        });
    }

    private void queryThemeFromWebView(WebView view) {
        if (view == null) return;
        view.evaluateJavascript(
            "(function(){ try { return localStorage.getItem('tradevault_theme_v1') || 'dark'; } catch(e) { return 'dark'; } })()",
            value -> {
                if (value == null) return;
                String clean = value.replace("\"", "").trim();
                if ("light".equalsIgnoreCase(clean) || "dark".equalsIgnoreCase(clean)) {
                    persistAndApplyTheme(clean);
                }
            }
        );
    }

    private void persistAndApplyTheme(String theme) {
        String normalized = "light".equalsIgnoreCase(theme) ? "light" : "dark";
        currentAppTheme = normalized;
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, normalized)
            .apply();
        applySystemBarThemeColors(normalized);
    }

    private void enforceSystemBarAppearance(boolean isLight) {
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(isLight);
            controller.setAppearanceLightNavigationBars(isLight);
        }
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarThemeColors(final String themeName) {
        final boolean isLight = "light".equalsIgnoreCase(themeName);
        final int topColor = isLight ? LIGHT_TOP_BAR_COLOR : DARK_TOP_BAR_COLOR;
        final int bottomColor = isLight ? LIGHT_BOTTOM_BAR_COLOR : DARK_BOTTOM_BAR_COLOR;

        runOnUiThread(() -> {
            Window window = getWindow();
            if (window == null) return;

            View decorView = window.getDecorView();
            activeBarsDrawable = new SplitSystemBarsDrawable(topColor, bottomColor);
            decorView.setBackground(activeBarsDrawable);

            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);

            window.setStatusBarColor(topColor);
            window.setNavigationBarColor(bottomColor);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.setNavigationBarDividerColor(bottomColor);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }

            enforceSystemBarAppearance(isLight);

            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(topColor);
            }
        });
    }

    public class SystemBarsThemeBridge {
        @JavascriptInterface
        public void setTheme(String theme) {
            persistAndApplyTheme(theme);
        }

        @JavascriptInterface
        public void setScreenOrientation(final String mode) {
            runOnUiThread(() -> {
                if ("landscape".equalsIgnoreCase(mode)) {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                } else {
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                }
            });
        }
    }

    /**
     * Paints the top half of the DecorView with the exact Navbar color (#050607 dark / #FFFFFF light)
     * and the bottom half with the exact MobileNav color (#0B0D11 dark / #FFFFFF light).
     * Because the WebView covers the middle of the screen, the exposed top status bar padding and
     * bottom navigation bar padding seamlessly match the top and bottom bars of the app on all Android versions.
     */
    private static class SplitSystemBarsDrawable extends Drawable {
        private final Paint topPaint = new Paint();
        private final Paint bottomPaint = new Paint();

        SplitSystemBarsDrawable(int topColor, int bottomColor) {
            topPaint.setColor(topColor);
            topPaint.setStyle(Paint.Style.FILL);
            bottomPaint.setColor(bottomColor);
            bottomPaint.setStyle(Paint.Style.FILL);
        }

        @Override
        public void draw(@NonNull Canvas canvas) {
            Rect bounds = getBounds();
            int midY = bounds.centerY();
            canvas.drawRect(bounds.left, bounds.top, bounds.right, midY, topPaint);
            canvas.drawRect(bounds.left, midY, bounds.right, bounds.bottom, bottomPaint);
        }

        @Override
        public void setAlpha(int alpha) {
            topPaint.setAlpha(alpha);
            bottomPaint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(@Nullable ColorFilter colorFilter) {
            topPaint.setColorFilter(colorFilter);
            bottomPaint.setColorFilter(colorFilter);
        }

        @Override
        @SuppressWarnings("deprecation")
        public int getOpacity() {
            return PixelFormat.OPAQUE;
        }
    }
}
