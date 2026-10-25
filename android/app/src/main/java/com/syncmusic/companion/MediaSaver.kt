package com.syncmusic.companion

import android.content.ContentValues
import android.content.Context
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import org.json.JSONObject
import java.io.IOException

/** PC에서 받은 곡을 Music/SyncMusic/에 저장한다. MediaStore에 넣으므로 삼성 뮤직이 바로 인식한다 */
object MediaSaver {
    class Saved(val path: String, val qh: String)

    fun download(context: Context, client: PcClient, d: JSONObject): Saved {
        val resolver = context.contentResolver
        val id = d.getString("id")
        val name = safeName(d.getString("name"))
        val ext = name.substringAfterLast('.', "").lowercase()
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)?.takeIf { it.startsWith("audio/") }
            ?: throw IOException("$name: 이 폰이 모르는 형식이에요")
        val relDir = d.optString("relDir").split('/')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it != "." && it != ".." }
            .joinToString("/") { safeName(it) }
        val relativePath = "Music/SyncMusic/" + if (relDir.isEmpty()) "" else "$relDir/"

        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, mime)
            put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)
            put(MediaStore.Audio.Media.IS_PENDING, 1) // 다 받을 때까지 다른 앱(삼성 뮤직)에 안 보이게
        }
        val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: throw IOException("$name: 저장할 수 없어요")
        try {
            val out = resolver.openOutputStream(uri, "w") ?: throw IOException("$name: 파일을 열 수 없어요")
            out.use { client.download(id, it) }
            if (QuickHash.of(resolver, uri) != id) throw IOException("$name: 받은 파일이 손상됐어요")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            throw e
        }

        // 같은 이름이 있으면 MediaStore가 "곡 (1).mp3"처럼 바꾸므로 실제 경로를 다시 읽는다
        val path = resolver.query(uri, arrayOf(MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) ?: "/storage/emulated/0/$relativePath${c.getString(1)}" else null
        } ?: "/storage/emulated/0/$relativePath$name"
        return Saved(path, id)
    }

    fun safeName(s: String): String =
        s.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().trimEnd('.').ifEmpty { "_" }.take(120)
}
