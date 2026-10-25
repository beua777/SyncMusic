package com.syncmusic.companion

import org.json.JSONArray
import org.json.JSONObject

/**
 * 삼성 뮤직 재생목록 파일 읽기/쓰기 (PC의 pc/src/m3u.js와 같은 규칙).
 * - .m3u / .m3u8: 줄마다 경로, #EXTINF:길이,가수 - 제목
 * - .smpl: 구형 기기의 JSON { name, members: [{ info: 경로, order, title, artist }] }
 */
object PlaylistFormat {
    data class Item(val path: String, val title: String? = null, val artist: String? = null, val durationSec: Double? = null)

    data class Parsed(val name: String, val items: List<Item>, val format: String)

    val EXTENSIONS = setOf("m3u", "m3u8", "smpl")

    private val EXTINF = Regex("""^#EXTINF:\s*(-?[\d.]+)?[^,]*,(.*)$""", RegexOption.IGNORE_CASE)

    fun parse(text: String, fileName: String): Parsed {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        val baseName = fileName.substringBeforeLast('.')
        val body = text.removePrefix("﻿")
        if (ext == "smpl" || body.trimStart().startsWith("{")) return parseSmpl(body, baseName)

        val items = mutableListOf<Item>()
        var name = baseName
        var pending: Item? = null
        for (raw in body.lines()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("#")) {
                val m = EXTINF.find(line)
                if (m != null) {
                    val dur = m.groupValues[1].toDoubleOrNull()
                    val (artist, title) = splitLabel(m.groupValues[2].trim())
                    pending = Item("", title, artist, if (dur != null && dur > 0) dur else null)
                } else if (line.startsWith("#PLAYLIST:", ignoreCase = true)) {
                    name = line.substring(10).trim().ifEmpty { name }
                }
                continue
            }
            items += (pending ?: Item("")).copy(path = decodePath(line))
            pending = null
        }
        return Parsed(name, items, if (ext == "m3u8") "m3u8" else "m3u")
    }

    /** 삼성 뮤직 가져오기용 .m3u (UTF-8, 절대 경로) */
    fun writeM3u(items: List<Item>): String = buildString {
        append("#EXTM3U\n")
        for (it in items) {
            val dur = it.durationSec?.takeIf { d -> d > 0 }?.let { d -> Math.round(d).toString() } ?: "-1"
            val label = listOf(it.artist, it.title).filter { s -> !s.isNullOrEmpty() }.joinToString(" - ")
            append("#EXTINF:").append(dur).append(',').append(label).append('\n')
            append(it.path).append('\n')
        }
    }

    /**
     * 삼성 뮤직 .smpl (PC의 writeSmpl과 같음). 실제 갤럭시(S26)가 내보낸 파일 모양을 따른다:
     * 한 줄 JSON, members는 order가 큰 곡부터(재생 순서는 order 오름차순), <>는 < >, 슬래시는 그대로.
     * template = 기존 파일 내용이 있으면 recentlyPlayedDate·sortBy·version을 그대로 둔다.
     */
    fun writeSmpl(name: String, items: List<Item>, template: JSONObject? = null): String {
        val members = JSONArray()
        for (i in items.indices.reversed()) {
            val it = items[i]
            members.put(
                JSONObject()
                    .put("artist", it.artist?.takeIf { a -> a.isNotEmpty() } ?: "<unknown>")
                    .put("info", it.path)
                    .put("order", i + 1)
                    .put("title", it.title?.takeIf { t -> t.isNotEmpty() } ?: it.path.substringAfterLast('/').substringBeforeLast('.'))
                    .put("type", 65537),
            )
        }
        val root = JSONObject()
            .put("members", members)
            .put("name", name)
            .put("recentlyPlayedDate", template?.optLong("recentlyPlayedDate", 0L) ?: 0L)
            .put("sortBy", template?.optInt("sortBy", 4) ?: 4)
            .put("version", template?.optInt("version", 1) ?: 1)
        return root.toString()
            .replace("\\/", "/")
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
    }

    private fun parseSmpl(body: String, baseName: String): Parsed {
        val j = try {
            JSONObject(body)
        } catch (e: Exception) {
            return Parsed(baseName, emptyList(), "smpl")
        }
        val arr = j.optJSONArray("members") ?: j.optJSONArray("items") ?: j.optJSONArray("tracks")
        val list = mutableListOf<Pair<Double, Item>>()
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val m = arr.optJSONObject(i) ?: continue
                val path = listOf("info", "path", "data", "uri").firstNotNullOfOrNull { k -> m.optString(k, "").takeIf { it.isNotEmpty() } } ?: ""
                val title = m.optString("title", "").ifEmpty { null }
                if (path.isEmpty() && title == null) continue
                val order = if (m.has("order")) m.optDouble("order", i.toDouble()) else i.toDouble()
                list += order to Item(path, title, m.optString("artist", "").ifEmpty { null })
            }
        }
        val sorted = list.withIndex()
            .sortedWith(compareBy<IndexedValue<Pair<Double, Item>>>({ it.value.first }, { it.index }))
            .map { it.value.second }
        return Parsed(j.optString("name", "").ifEmpty { baseName }, sorted, "smpl")
    }

    private fun splitLabel(label: String): Pair<String?, String?> {
        val i = label.indexOf(" - ")
        return if (i > 0) label.substring(0, i).trim() to label.substring(i + 3).trim() else null to label.ifEmpty { null }
    }

    private fun decodePath(p: String): String {
        if (!p.startsWith("file://", ignoreCase = true)) return p
        return try {
            java.net.URI(p).path ?: p
        } catch (e: Exception) {
            p
        }
    }
}
