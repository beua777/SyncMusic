package com.syncmusic.companion

import android.content.ContentResolver
import android.net.Uri
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.security.MessageDigest

/**
 * 곡 ID (PC의 pc/src/quickhash.js와 같아야 함):
 * hex(SHA-256(크기 8바이트 빅엔디언 ‖ 앞 64KiB ‖ 뒤 min(64KiB, 크기−64KiB))) 앞 32글자
 */
object QuickHash {
    const val CHUNK = 64 * 1024

    fun ofBytes(data: ByteArray): String {
        val size = data.size.toLong()
        val md = MessageDigest.getInstance("SHA-256")
        md.update(ByteBuffer.allocate(8).putLong(size).array())
        md.update(data, 0, minOf(CHUNK.toLong(), size).toInt())
        if (size > CHUNK) {
            val tail = minOf(CHUNK.toLong(), size - CHUNK).toInt()
            md.update(data, (size - tail).toInt(), tail)
        }
        return SyncCrypto.hex(md.digest()).substring(0, 32)
    }

    fun of(resolver: ContentResolver, uri: Uri): String? = try {
        resolver.openFileDescriptor(uri, "r")?.use { pfd ->
            FileInputStream(pfd.fileDescriptor).use { input -> ofChannel(input.channel) }
        }
    } catch (e: Exception) {
        null
    }

    fun ofChannel(ch: FileChannel): String {
        val size = ch.size()
        val md = MessageDigest.getInstance("SHA-256")
        md.update(ByteBuffer.allocate(8).putLong(size).array())
        md.update(readAt(ch, 0, minOf(CHUNK.toLong(), size).toInt()))
        if (size > CHUNK) {
            val tail = minOf(CHUNK.toLong(), size - CHUNK).toInt()
            md.update(readAt(ch, size - tail, tail))
        }
        return SyncCrypto.hex(md.digest()).substring(0, 32)
    }

    private fun readAt(ch: FileChannel, position: Long, length: Int): ByteArray {
        val buf = ByteBuffer.allocate(length)
        var p = position
        while (buf.hasRemaining()) {
            val n = ch.read(buf, p)
            if (n <= 0) break
            p += n
        }
        return buf.array().copyOf(buf.position())
    }
}
