package io.github.smitravitz.dictionarius;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own native plugin (plugins in node_modules register themselves).
        registerPlugin(EdgeGesturesPlugin.class);
        super.onCreate(savedInstanceState);
        // Range requests for the definitions answered exactly (Capacitor's own server sends the whole file).
        bridge.setWebViewClient(new RangedAssets(bridge));
    }
}
