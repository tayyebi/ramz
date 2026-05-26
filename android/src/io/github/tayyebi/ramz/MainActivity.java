package io.github.tayyebi.ramz;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.Toast;
import android.view.Gravity;

/**
 * Ramz Password Manager — Android client.
 *
 * A minimal WebView wrapper that connects to a self-hosted Ramz backend.
 * The user enters their server URL on first launch; it is persisted in
 * SharedPreferences for subsequent starts.
 *
 * Zero dependency on Gradle, Maven, or any build system beyond the raw
 * Android SDK command-line tools.
 */
public class MainActivity extends Activity {

    private static final String PREFS_NAME   = "ramz_prefs";
    private static final String KEY_BASE_URL = "base_url";

    private WebView webView = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String savedUrl = prefs.getString(KEY_BASE_URL, null);

        if (savedUrl != null && !savedUrl.isEmpty()) {
            showWebView(savedUrl);
        } else {
            showUrlPrompt();
        }
    }

    /**
     * Show a simple prompt so the user can type their Ramz server URL.
     */
    private void showUrlPrompt() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        int pad = dpToPx(32);
        layout.setPadding(pad, pad, pad, pad);

        final EditText input = new EditText(this);
        input.setHint("https://ramz.example.com");
        input.setSingleLine(true);
        layout.addView(input);

        Button btn = new Button(this);
        btn.setText("Connect");
        btn.setOnClickListener(v -> {
            String url = input.getText().toString().trim();
            if (url.isEmpty()) {
                Toast.makeText(this, "Please enter a URL", Toast.LENGTH_SHORT).show();
                return;
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
            }
            // Persist the URL
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(KEY_BASE_URL, url)
                .apply();
            showWebView(url);
        });
        layout.addView(btn);

        setContentView(layout);
    }

    /**
     * Replace the current view with a full-screen WebView pointed at the
     * given Ramz backend URL.
     */
    private void showWebView(String baseUrl) {
        webView = new WebView(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);

        webView.setWebViewClient(new WebViewClientImpl(this, baseUrl));
        webView.setWebChromeClient(new WebChromeClient());
        webView.setScrollBarStyle(WebView.SCROLLBARS_OUTSIDE_OVERLAY);

        webView.loadUrl(baseUrl);
        setContentView(webView);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private int dpToPx(int dp) {
        float scale = getResources().getDisplayMetrics().density;
        return (int) (dp * scale + 0.5f);
    }
}
