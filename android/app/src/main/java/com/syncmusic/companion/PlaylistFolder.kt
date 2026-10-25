package com.syncmusic.companion

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import java.nio.charset.Charset

/**
 * 삼성 뮤직 '플레이리스트 관리'에서 고른 폴더 (사용자가 SAF로 한 번 허락).
 * 삼성 뮤직의 '모든 플레이리스트 자동 백업'이 여기에 재생목록 파일을 쓰고,
 * 우리는 PC에서 바뀐 재생목록을 여기에 .m3u로 써 둔다 → 삼성 뮤직 '플레이리스트 가져오기'.
 */
class PlaylistFolder(private val context: Context, private val treeUri: Uri) {
    private val root: DocumentFile? = DocumentFile.fromTreeUri(context, treeUri)

    class Entry(val name: String, val bytes: ByteArray, val lastModified: Long) {
        val text: String get() = decode(bytes)
        val sha: String get() = SyncCrypto.sha256hex(bytes)
    }

    val usable: Boolean get() = root?.let { it.exists() && it.canRead() } == true

    /** "primary:Music/Playlists" → "/storage/emulated/0/Music/Playlists" (상대 경로로 적힌 항목 해석용) */
    val absolutePath: String
        get() {
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val volume = docId.substringBefore(':')
            val rel = docId.substringAfter(':', "")
            val base = if (volume.equals("primary", ignoreCase = true)) "/storage/emulated/0" else "/storage/$volume"
            return if (rel.isEmpty()) base else "$base/$rel"
        }

    val displayPath: String
        get() = DocumentsContract.getTreeDocumentId(treeUri).replaceFirst("primary:", "내장 메모리/")

    fun list(): List<Entry> = root?.listFiles().orEmpty()
        .filter { doc -> doc.isFile && doc.name.let { n -> n != null && n.substringAfterLast('.', "").lowercase() in PlaylistFormat.EXTENSIONS } }
        .mapNotNull { doc -> runCatching { Entry(doc.name!!, read(doc), doc.lastModified()) }.getOrNull() }

    fun find(name: String): Entry? = root?.findFile(name)?.takeIf { it.isFile }
        ?.let { doc -> runCatching { Entry(name, read(doc), doc.lastModified()) }.getOrNull() }

    fun write(name: String, bytes: ByteArray): Boolean {
        val dir = root ?: return false
        val doc = dir.findFile(name) ?: dir.createFile("application/octet-stream", name) ?: return false
        val resolver = context.contentResolver
        val out = runCatching { resolver.openOutputStream(doc.uri, "wt") }.getOrNull() ?: resolver.openOutputStream(doc.uri, "w") ?: return false
        out.use { it.write(bytes) }
        return true
    }

    fun delete(name: String): Boolean = root?.findFile(name)?.delete() == true

    private fun read(doc: DocumentFile): ByteArray =
        context.contentResolver.openInputStream(doc.uri)?.use { it.readBytes() } ?: ByteArray(0)

    companion object {
        /** UTF-8이 아니면(예전 Windows 프로그램이 만든 파일) CP949로 읽어 본다 */
        fun decode(bytes: ByteArray): String {
            val utf8 = String(bytes, Charsets.UTF_8)
            if (!utf8.contains('�')) return utf8.removePrefix("﻿")
            for (name in listOf("x-windows-949", "MS949", "EUC-KR")) {
                runCatching { return String(bytes, Charset.forName(name)) }
            }
            return utf8
        }
    }
}
