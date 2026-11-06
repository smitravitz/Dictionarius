package io.github.smitravitz.dictionarius;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Answers Range requests for the app's data files with exactly the bytes asked for, so
 * the page reads the definitions a block at a time instead of holding whole files
 * (src/definitions.ts, rangeSource; ADR-0005). Capacitor's own server answers a Range
 * request with 206 but sends the whole file (WebViewLocalServer.handleLocalRequest), so
 * the page would never read in place without this. The reading is AssetRanges'; anything
 * it can't answer exactly goes to Capacitor as before.
 */
final class RangedAssets extends BridgeWebViewClient {

    /** The data files read in place: the definitions and their layers, beside the index. */
    private static final Pattern DATA = Pattern.compile("/headwords[\\w.-]*\\.(definitions|examples|etymology|pronunciation)\\.bin");

    private final AssetRanges ranges;

    RangedAssets(Bridge bridge) {
        super(bridge);
        this.ranges = new AssetRanges(bridge.getContext().getAssets());
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String path = request.getUrl().getPath();
        String range = header(request, "Range");
        if (range == null || path == null || !DATA.matcher(path).matches()) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            AssetRanges.Answer answer = ranges.read("public" + path, range); // Capacitor serves the web app from assets/public
            if (answer == null) return super.shouldInterceptRequest(view, request);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Range", answer.contentRange);
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-store"); // read from the APK each time: nothing to keep
            return new WebResourceResponse("application/octet-stream", null, 206, "Partial Content", headers, new ByteArrayInputStream(answer.body));
        } catch (IOException | RuntimeException e) {
            return super.shouldInterceptRequest(view, request);
        }
    }

    private static String header(WebResourceRequest request, String name) {
        for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }
}
