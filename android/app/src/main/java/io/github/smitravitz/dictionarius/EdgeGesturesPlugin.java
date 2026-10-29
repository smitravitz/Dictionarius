package io.github.smitravitz.dictionarius;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Turns the phone's edge gestures (Back, with gesture navigation) off in
 * strips the web page names, so a thumb holding the position slider near an
 * edge isn't taken away mid-slide (web/edge-gestures.ts says where). Android
 * honours at most 200 dp per edge, and only from Android 10 (API 29) on.
 * Needs no permission.
 */
@CapacitorPlugin(name = "EdgeGestures")
public class EdgeGesturesPlugin extends Plugin {

    /** strips: [{x, y, width, height}] in CSS pixels; an empty list turns them all back on. */
    @PluginMethod
    public void exclude(PluginCall call) {
        JSArray strips = call.getArray("strips", new JSArray());
        float density = getContext().getResources().getDisplayMetrics().density; // CSS px to the WebView's pixels
        List<Rect> rects = new ArrayList<>();
        try {
            for (int i = 0; i < strips.length(); i++) {
                JSONObject s = strips.getJSONObject(i);
                int left = Math.round((float) s.getDouble("x") * density);
                int top = Math.round((float) s.getDouble("y") * density);
                int right = left + Math.round((float) s.getDouble("width") * density);
                int bottom = top + Math.round((float) s.getDouble("height") * density);
                rects.add(new Rect(left, top, right, bottom));
            }
        } catch (JSONException e) {
            call.reject("strips must be [{x, y, width, height}]");
            return;
        }
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            if (view != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                view.setSystemGestureExclusionRects(rects);
            }
            call.resolve();
        });
    }
}
