package io.github.smitravitz.dictionarius.haptictick;

import android.view.HapticFeedbackConstants;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Haptic feedback through the WebView itself. Unlike the Vibrator service,
 * View.performHapticFeedback needs no permission, and it follows the phone's
 * "touch feedback" setting.
 */
@CapacitorPlugin(name = "HapticTick")
public class HapticTickPlugin extends Plugin {

    /** A hold that opened something: the same feel as a long press. */
    @PluginMethod
    public void pulse(PluginCall call) {
        feel(call, HapticFeedbackConstants.LONG_PRESS);
    }

    /** One step along a scale. */
    @PluginMethod
    public void tick(PluginCall call) {
        feel(call, HapticFeedbackConstants.CLOCK_TICK);
    }

    private void feel(PluginCall call, int feedback) {
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            if (view != null) view.performHapticFeedback(feedback);
            call.resolve();
        });
    }
}
