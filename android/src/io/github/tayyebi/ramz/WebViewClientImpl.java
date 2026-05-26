package io.github.tayyebi.ramz;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Keeps navigation inside the WebView for the configured Ramz server
 * and opens any external links in the system browser.
 */
public class WebViewClientImpl extends WebViewClient {

    private final Activity activity;
    private final String allowedHost;

    public WebViewClientImpl(Activity activity, String baseUrl) {
        this.activity = activity;
        this.allowedHost = Uri.parse(baseUrl).getHost();
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        String host = Uri.parse(url).getHost();
        if (host != null && allowedHost != null && host.equals(allowedHost)) {
            return false;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        activity.startActivity(intent);
        return true;
    }
}
