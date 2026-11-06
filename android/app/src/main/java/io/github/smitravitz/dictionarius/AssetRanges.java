package io.github.smitravitz.dictionarius;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Byte ranges of the app's assets, read where they lie in the APK (RangedAssets serves
 * them). Only an asset stored uncompressed can be read this way (build.gradle,
 * noCompress); for any other, and for a range it can't meet exactly, it answers null and
 * the caller sends the whole file. Tested on a device (AssetRangesTest), with garbage
 * collection between reads.
 */
final class AssetRanges {

    /** Exactly the bytes asked for, and the Content-Range header saying which. */
    static final class Answer {
        final byte[] body;
        final String contentRange;

        Answer(byte[] body, String contentRange) {
            this.body = body;
            this.contentRange = contentRange;
        }
    }

    private static final class Open {
        /** Kept for as long as the channel is used: when it's collected, Android closes
         *  the file under the channel (ParcelFileDescriptor's finalizer), and every read
         *  after that fails. Losing it was v0.6.0's missing definitions. */
        final AssetFileDescriptor descriptor;
        final FileChannel channel;
        final long base;
        final long size;

        Open(AssetFileDescriptor fd) {
            this.descriptor = fd;
            this.channel = new FileInputStream(fd.getFileDescriptor()).getChannel();
            this.base = fd.getStartOffset();
            this.size = fd.getLength();
        }
    }

    private final AssetManager assets;
    /** Each asset opened once (from any thread; positional reads don't share a position). */
    private final Map<String, Open> open = new ConcurrentHashMap<>();

    AssetRanges(AssetManager assets) {
        this.assets = assets;
    }

    /** The bytes the Range header `range` asks of asset `path`, or null (see above). */
    Answer read(String path, String range) throws IOException {
        Open file = open.computeIfAbsent(path, this::openAsset);
        if (file == null) return null;
        long[] bytes = ByteRanges.parse(range, file.size);
        if (bytes == null) return null;
        return new Answer(ByteRanges.read(file.channel, file.base, bytes), ByteRanges.contentRange(bytes, file.size));
    }

    private Open openAsset(String path) {
        try {
            return new Open(assets.openFd(path));
        } catch (IOException compressedOrMissing) {
            return null;
        }
    }
}
