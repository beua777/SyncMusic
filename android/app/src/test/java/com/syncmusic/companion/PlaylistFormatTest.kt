package com.syncmusic.companion

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** PC의 pc/test/m3u.test.js와 같은 경우들 */
class PlaylistFormatTest {
    @Test
    fun samsungM3uWithAbsolutePaths() {
        val text = "#EXTM3U\n#EXTINF:215,아이유 - 밤편지\n/storage/emulated/0/Music/아이유/밤편지.mp3\n#EXTINF:-1,\n/storage/emulated/0/Download/song.flac\n"
        val p = PlaylistFormat.parse(text, "드라이브.m3u")
        assertEquals("드라이브", p.name)
        assertEquals("m3u", p.format)
        assertEquals(PlaylistFormat.Item("/storage/emulated/0/Music/아이유/밤편지.mp3", "밤편지", "아이유", 215.0), p.items[0])
        assertEquals("/storage/emulated/0/Download/song.flac", p.items[1].path)
        assertNull(p.items[1].durationSec)
    }

    @Test
    fun bomCrlfFileUrlAndPlaylistName() {
        val text = "\uFEFF#EXTM3U\r\n#PLAYLIST:여름 노래\r\nfile:///C:/Music/%EC%97%AC%EB%A6%84.mp3\r\n\r\nD:\\Music\\b.mp3\r\n"
        val p = PlaylistFormat.parse(text, "x.m3u8")
        assertEquals("여름 노래", p.name)
        assertEquals("m3u8", p.format)
        assertEquals(listOf("/C:/Music/여름.mp3", "D:\\Music\\b.mp3"), p.items.map { it.path })
    }

    @Test
    fun oldSamsungSmplIsOrderedByOrderField() {
        val smpl = """{"name":"운동","members":[{"info":"/storage/emulated/0/Music/b.mp3","order":2,"title":"B","artist":"X"},{"info":"/storage/emulated/0/Music/a.mp3","order":1,"title":"A","artist":"X"}],"sortBy":4,"version":1}"""
        val p = PlaylistFormat.parse(smpl, "운동.smpl")
        assertEquals("운동", p.name)
        assertEquals("smpl", p.format)
        assertEquals(listOf("A", "B"), p.items.map { it.title })
        assertEquals("/storage/emulated/0/Music/a.mp3", p.items[0].path)
    }

    @Test
    fun writeSmplLooksLikeSamsungAndRoundTrips() {
        val items = listOf(
            PlaylistFormat.Item("/storage/emulated/0/Music/a.mp3", "A", null),
            PlaylistFormat.Item("/storage/emulated/0/Music/b.mp3", "B", "가수"),
        )
        val template = JSONObject().put("recentlyPlayedDate", 1791370269L).put("sortBy", 4).put("version", 1)
        val text = PlaylistFormat.writeSmpl("출근길", items, template)
        assertFalse(text.contains("\n"))
        assertFalse(text.contains("\\/"))
        assertTrue(text.contains("\\u003cunknown\\u003e"))
        val j = JSONObject(text)
        val members = j.getJSONArray("members")
        assertEquals(listOf(2, 1), List(members.length()) { members.getJSONObject(it).getInt("order") })
        assertEquals(1791370269L, j.getLong("recentlyPlayedDate"))
        assertEquals("출근길", j.getString("name"))
        val back = PlaylistFormat.parse(text, "출근길.smpl")
        assertEquals(items.map { it.path }, back.items.map { it.path })
        assertEquals("<unknown>", back.items[0].artist)
    }

    @Test
    fun writeThenParseKeepsOrderAndKorean() {
        val items = listOf(
            PlaylistFormat.Item("/storage/emulated/0/Music/SyncMusic/하늘빛/꽃길.wav", "꽃길", "하늘빛", 20.4),
            PlaylistFormat.Item("/storage/emulated/0/Music/x.mp3", "X", null, 0.0),
        )
        val text = PlaylistFormat.writeM3u(items)
        assertTrue(text.startsWith("#EXTM3U\n#EXTINF:20,하늘빛 - 꽃길\n"))
        val back = PlaylistFormat.parse(text, "a.m3u")
        assertEquals(items.map { it.path }, back.items.map { it.path })
        assertEquals(listOf("꽃길", "X"), back.items.map { it.title })
    }
}
