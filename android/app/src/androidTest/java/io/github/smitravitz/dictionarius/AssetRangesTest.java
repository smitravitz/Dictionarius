package io.github.smitravitz.dictionarius;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.content.res.AssetManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * On a device, with the app's own assets (CI builds it with the test word list): every
 * range AssetRanges reads is the file's own bytes, however many reads, from however many
 * threads, with garbage collection in between (v0.6.0 lost its files to it).
 */
@RunWith(AndroidJUnit4.class)
public class AssetRangesTest {

    private static final String[] DATA = {
        "public/headwords-sample.definitions.bin",
        "public/headwords-sample.examples.bin",
        "public/headwords-sample.etymology.bin",
        "public/headwords-sample.pronunciation.bin",
    };

    private final AssetManager assets = InstrumentationRegistry.getInstrumentation().getTargetContext().getAssets();

    private byte[] whole(String path) throws IOException {
        try (InputStream in = assets.open(path)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private static void collectGarbage() {
        Runtime.getRuntime().gc();
        System.runFinalization();
        Runtime.getRuntime().gc();
    }

    private static void check(AssetRanges ranges, String path, byte[] all, Random random) throws IOException {
        int start = random.nextInt(all.length);
        int end = start + 1 + random.nextInt(all.length - start);
        AssetRanges.Answer answer = ranges.read(path, "bytes=" + start + "-" + (end - 1));
        assertNotNull(path + " " + start + "-" + end, answer);
        assertArrayEquals(path + " " + start + "-" + end, Arrays.copyOfRange(all, start, end), answer.body);
        assertEquals("bytes " + start + "-" + (end - 1) + "/" + all.length, answer.contentRange);
    }

    @Test
    public void everyRangeIsTheFilesOwnBytesEvenAfterGarbageCollection() throws IOException {
        AssetRanges ranges = new AssetRanges(assets);
        Random random = new Random(7);
        for (int round = 0; round < 20; round++) {
            for (String path : DATA) {
                byte[] all = whole(path);
                for (int i = 0; i < 10; i++) check(ranges, path, all, random);
            }
            collectGarbage();
        }
    }

    @Test
    public void readsFromManyThreadsAtOnce() throws Exception {
        AssetRanges ranges = new AssetRanges(assets);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        try {
            List<Future<?>> reads = new ArrayList<>();
            for (int t = 0; t < 400; t++) {
                final String path = DATA[t % DATA.length];
                final byte[] all = whole(path);
                final Random random = new Random(t);
                reads.add(pool.submit(() -> {
                    check(ranges, path, all, random);
                    if (random.nextInt(50) == 0) collectGarbage();
                    return null;
                }));
            }
            for (Future<?> read : reads) read.get();
        } finally {
            pool.shutdown();
        }
    }

    @Test
    public void leavesToTheWholeFileWhatItCantReadInPlace() throws IOException {
        AssetRanges ranges = new AssetRanges(assets);
        assertNull("a file that isn't there", ranges.read("public/headwords-sample.nothing.bin", "bytes=0-9"));
        assertNull("a file stored compressed", ranges.read("public/index.html", "bytes=0-9"));
        assertNull("a range past the end", ranges.read(DATA[0], "bytes=999999-1000000"));
    }
}
