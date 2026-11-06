package io.github.smitravitz.dictionarius;

import java.io.EOFException;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTTP byte ranges (RFC 9110, section 14) for RangedAssets: which bytes a Range header
 * asks for, and reading exactly those from a file. Plain Java, so it is tested without
 * a phone (ByteRangesTest).
 */
final class ByteRanges {

    private static final Pattern ONE_RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    private ByteRanges() {}

    /**
     * The bytes a Range header asks for, as {start, end} with end excluded, kept within a
     * file of `size` bytes; null for none, several ranges, or one that can't be met (the
     * caller then sends the whole file, which HTTP allows).
     */
    static long[] parse(String header, long size) {
        if (header == null) return null;
        Matcher m = ONE_RANGE.matcher(header.trim());
        if (!m.matches()) return null;
        String first = m.group(1);
        String last = m.group(2);
        try {
            if (first.isEmpty()) { // "bytes=-n": the last n bytes
                if (last.isEmpty()) return null;
                long n = Long.parseLong(last);
                if (n == 0) return null;
                return new long[] { Math.max(0, size - n), size };
            }
            long start = Long.parseLong(first);
            long end = last.isEmpty() ? size : Math.min(size, Long.parseLong(last) + 1);
            if (start >= size || end <= start) return null;
            return new long[] { start, end };
        } catch (NumberFormatException tooBig) {
            return null;
        }
    }

    /** The Content-Range header for `range` of a file of `size` bytes. */
    static String contentRange(long[] range, long size) {
        return "bytes " + range[0] + "-" + (range[1] - 1) + "/" + size;
    }

    /**
     * Exactly the bytes `range` names of a file that starts `base` bytes into `channel` (an
     * asset inside the APK). Positional reads: safe from several threads at once.
     */
    static byte[] read(FileChannel channel, long base, long[] range) throws IOException {
        ByteBuffer buffer = ByteBuffer.allocate((int) (range[1] - range[0]));
        long at = base + range[0];
        while (buffer.hasRemaining()) {
            int n = channel.read(buffer, at);
            if (n < 0) throw new EOFException("the file ends before byte " + (range[1] - 1));
            at += n;
        }
        return buffer.array();
    }
}
