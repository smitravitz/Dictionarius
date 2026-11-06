package io.github.smitravitz.dictionarius;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.channels.FileChannel;
import org.junit.Test;

/** How the app answers a Range request for its data files (RangedAssets): exactly the bytes asked for. */
public class ByteRangesTest {

    @Test
    public void aRangeIsFromItsFirstByteToItsLastIncluded() {
        assertArrayEquals(new long[] { 0, 64 }, ByteRanges.parse("bytes=0-63", 1000));
        assertArrayEquals(new long[] { 100, 200 }, ByteRanges.parse("bytes=100-199", 1000));
    }

    @Test
    public void anOpenOrOverlongRangeStopsAtTheEndOfTheFile() {
        assertArrayEquals(new long[] { 900, 1000 }, ByteRanges.parse("bytes=900-", 1000));
        assertArrayEquals(new long[] { 900, 1000 }, ByteRanges.parse("bytes=900-5000", 1000));
    }

    @Test
    public void aSuffixRangeIsTheLastBytes() {
        assertArrayEquals(new long[] { 990, 1000 }, ByteRanges.parse("bytes=-10", 1000));
    }

    @Test
    public void whatItCantAnswerExactlyIsLeftToTheWholeFile() {
        assertNull(ByteRanges.parse(null, 1000));
        assertNull(ByteRanges.parse("bytes=1000-1010", 1000)); // past the end
        assertNull(ByteRanges.parse("bytes=5-2", 1000)); // backwards
        assertNull(ByteRanges.parse("bytes=0-1,5-6", 1000)); // several ranges
        assertNull(ByteRanges.parse("items=0-1", 1000));
        assertNull(ByteRanges.parse("bytes=-0", 1000));
    }

    @Test
    public void saysWhichBytesItSent() {
        assertEquals("bytes 100-199/1000", ByteRanges.contentRange(new long[] { 100, 200 }, 1000));
    }

    @Test
    public void readsExactlyTheBytesAskedFor() throws Exception {
        // A file standing in for the APK, with the asset at offset 7 inside it (as openFd gives it).
        byte[] asset = new byte[300];
        for (int i = 0; i < asset.length; i++) asset[i] = (byte) i;
        File apk = File.createTempFile("apk", ".bin");
        apk.deleteOnExit();
        try (FileOutputStream out = new FileOutputStream(apk)) {
            out.write(new byte[7]);
            out.write(asset);
        }
        try (FileChannel channel = new FileInputStream(apk).getChannel()) {
            byte[] got = ByteRanges.read(channel, 7, new long[] { 100, 164 });
            byte[] expected = new byte[64];
            System.arraycopy(asset, 100, expected, 0, 64);
            assertArrayEquals(expected, got);
        }
    }
}
