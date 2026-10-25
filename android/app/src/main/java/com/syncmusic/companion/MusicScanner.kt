package com.syncmusic.companion

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import org.json.JSONObject
import java.io.File

data class PhoneTrack(
    val mediaId: Long,
    val uri: Uri,
    val path: String,
    val displayName: String,
    val size: Long,
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val qh: String,
)

/** 폰의 음악 목록 = 삼성 뮤직이 보는 것과 같은 MediaStore. quick hash는 캐시해서 두 번째부터 빠르다 */
class MusicScanner(private val context: Context) {
    private val cacheFile = File(context.filesDir, "qh-cache.json")

    private class Row(
        val id: Long,
        val uri: Uri,
        val path: String,
        val name: String,
        val size: Long,
        val modified: Long,
        val title: String,
        val artist: String,
        val album: String,
        val duration: Long,
    )

    fun scan(): List<PhoneTrack> {
        val resolver = context.contentResolver
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DATA,
            MediaStore.Audio.Media.RELATIVE_PATH,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.VOLUME_NAME,
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.SIZE} > 1024"
        val rows = mutableListOf<Row>()
        resolver.query(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL), projection, selection, null, null)?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val iData = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA)
            val iRel = c.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
            val iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val iMod = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
            val iTitle = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val iArtist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val iAlbum = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val iDur = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val iVol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.VOLUME_NAME)
            while (c.moveToNext()) {
                val id = c.getLong(iId)
                val volume = c.getString(iVol) ?: MediaStore.VOLUME_EXTERNAL_PRIMARY
                val name = c.getString(iName) ?: continue
                val rel = c.getString(iRel).orEmpty()
                val base = if (volume == MediaStore.VOLUME_EXTERNAL_PRIMARY) "/storage/emulated/0" else "/storage/${volume.uppercase()}"
                rows += Row(
                    id = id,
                    uri = ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri(volume), id),
                    path = c.getString(iData) ?: "$base/$rel$name",
                    name = name,
                    size = c.getLong(iSize),
                    modified = c.getLong(iMod),
                    title = c.getString(iTitle)?.takeIf { it.isNotBlank() } ?: name.substringBeforeLast('.'),
                    artist = c.getString(iArtist).orEmpty(),
                    album = c.getString(iAlbum).orEmpty(),
                    duration = c.getLong(iDur),
                )
            }
        }

        val cache = runCatching { JSONObject(cacheFile.readText()) }.getOrElse { JSONObject() }
        val next = JSONObject()
        val out = ArrayList<PhoneTrack>(rows.size)
        for (r in rows) {
            val key = "${r.id}:${r.size}:${r.modified}"
            val qh = cache.optString(key, "").ifEmpty { QuickHash.of(resolver, r.uri).orEmpty() }
            if (qh.isEmpty()) continue
            next.put(key, qh)
            out += PhoneTrack(r.id, r.uri, r.path, r.name, r.size, r.title, r.artist, r.album, r.duration, qh)
        }
        runCatching { cacheFile.writeText(next.toString()) }
        return out
    }
}
