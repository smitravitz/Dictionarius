package io.github.smitravitz.dictionarius;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Answers Range requests for the app's data files with exactly the bytes asked for, so
 * the page reads the definitions a block at a time instead of holding whole files
 * (src/definitions.ts, rangeSource; ADR-0005). Capacitor's own server answers a Range
 * request with 206 but sends the whole file (WebViewLocalServer.handleLocalRequest), so
 * the page would never read in place without this.
 *
 * The files are stored uncompressed in the APK (build.gradle, noCompress), which lets a
 * block be read where it lies; they're brotli-compressed already, so that costs no size.
 * Anything else, or a file stored compressed, goes to Capacitor as before.
 */
final class RangedAssets extends BridgeWebViewClient {

    /** The data files read in place: the definitions and their layers, beside the index. */
    private static final Pattern DATA = Pattern.compile("/headwords[\\w.-]*\\.(definitions|examples|etymology|pronunciation)\\.bin");

    private final AssetManager assets;
    /** Each file, opened once: its channel into the APK and where in it the file starts. */
    private final Map<String, Open> open = new ConcurrentHashMap<>();

    private static final class Open {
        final FileChannel channel;
        final long base;
        final long size;

        Open(AssetFileDescriptor fd) {
            this.channel = new FileInputStream(fd.getFileDescriptor()).getChannel();
            this.base = fd.getStartOffset();
            this.size = fd.getLength();
        }
    }

    RangedAssets(Bridge bridge) {
        super(bridge);
        this.assets = bridge.getContext().getAssets();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String path = request.getUrl().getPath();
        String range = header(request, "Range");
        if (range == null || path == null || !DATA.matcher(path).matches()) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            Open file = open.computeIfAbsent(path, this::openAsset);
            if (file == null) return super.shouldInterceptRequest(view, request); // stored compressed: no reading in place
            long[] bytes = ByteRanges.parse(range, file.size);
            if (bytes == null) return super.shouldInterceptRequest(view, request);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Range", ByteRanges.contentRange(bytes, file.size));
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-store"); // read from the APK each time: nothing to keep
            byte[] body = ByteRanges.read(file.channel, file.base, bytes);
            return new WebResourceResponse("application/octet-stream", null, 206, "Partial Content", headers, new ByteArrayInputStream(body));
        } catch (IOException | RuntimeException e) {
            return super.shouldInterceptRequest(view, request);
        }
    }

    /** The asset behind `path` (Capacitor serves the web app from assets/public), or null if it's stored compressed or missing. */
    private Open openAsset(String path) {
        try {
            return new Open(assets.openFd("public" + path));
        } catch (IOException compressedOrMissing) {
            return null;
        }
    }

    private static String header(WebResourceRequest request, String name) {
        for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }
}
