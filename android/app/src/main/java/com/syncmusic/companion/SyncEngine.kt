package com.syncmusic.companion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class StoppedException : IOException("중간에 멈췄어요. 다음 동기화 때 이어서 해요")

/**
 * 동기화 한 번 (docs/PLAN.md 6.5). PC 쪽 pc/tools/fake-phone.js의 sync()와 같은 순서이고,
 * 그 흐름은 pc/test/sync.e2e.test.js가 실제 PC 서버로 검증한다.
 *   1) PC 찾기  2) 곡 목록 + 삼성 뮤직 백업 폴더의 재생목록 보내기  3) 올리기  4) 받기  5) 재생목록 쓰기  6) 결과 알리기
 */
class SyncEngine(
    private val context: Context,
    private val onProgress: (String) -> Unit = {},
    private val isStopped: () -> Boolean = { false },
) {
    private val prefs = Prefs(context)

    class Result(val uploaded: Int, val downloaded: Int, val playlistsWritten: Int, val notices: List<String>, val errors: List<String>) {
        val summary: String
            get() = "PC로 ${uploaded}곡 · 폰으로 ${downloaded}곡 · 재생목록 ${playlistsWritten}개" + if (errors.isEmpty()) "" else " · 오류 ${errors.size}개"
        val changed: Boolean get() = uploaded + downloaded + playlistsWritten > 0 || notices.isNotEmpty() || errors.isNotEmpty()
    }

    /** 지난번 주소 → 브로드캐스트로 찾기 → 직접 입력한 주소 순서로 같은 PC를 찾는다 */
    fun connect(): PcClient {
        val secret = prefs.secret ?: throw IOException("PC와 아직 연결되지 않았어요")
        val pcId = prefs.pcId ?: throw IOException("PC와 아직 연결되지 않았어요")
        prefs.pcHost?.let { host -> if (isSamePc(host, prefs.pcPort, pcId)) return PcClient(host, prefs.pcPort, prefs.deviceId, secret) }
        Discovery.find(context, wantPcId = pcId)?.let { f ->
            prefs.pcHost = f.host
            prefs.pcPort = f.port
            return PcClient(f.host, f.port, prefs.deviceId, secret)
        }
        prefs.manualHost?.let { manual ->
            val host = manual.substringBefore(':').trim()
            val port = manual.substringAfter(':', "").toIntOrNull() ?: Prefs.DEFAULT_SYNC_PORT
            if (host.isNotEmpty() && isSamePc(host, port, pcId)) {
                prefs.pcHost = host
                prefs.pcPort = port
                return PcClient(host, port, prefs.deviceId, secret)
            }
        }
        throw IOException("같은 Wi-Fi에서 ${prefs.pcName ?: "PC"}를 찾지 못했어요")
    }

    private fun isSamePc(host: String, port: Int, pcId: String): Boolean =
        runCatching { PcClient(host, port, prefs.deviceId, null).hello().optString("pcId") == pcId }.getOrDefault(false)

    fun run(): Result {
        if (!hasMediaPermission(context)) throw IOException("음악 파일 권한이 필요해요. 앱을 열어 권한을 허용해 주세요")
        val client = connect()

        onProgress("폰의 음악 목록을 확인하는 중…")
        val tracks = MusicScanner(context).scan()
        if (isStopped()) throw StoppedException()
        val byQh = HashMap<String, PhoneTrack>()
        val byName = HashMap<String, PhoneTrack>()
        for (t in tracks) {
            byQh.putIfAbsent(t.qh, t)
            byName.putIfAbsent(t.displayName.lowercase(), t)
        }
        val byPath = tracks.associateBy { it.path.lowercase() }

        // 삼성 뮤직에서 듣던 곡도 같이 알려 둔다 (알림 접근을 허용했을 때만) → PC 화면에 '이어 듣기'
        runCatching { NowPlaying.read(context, tracks)?.let { client.postJson("/sync/nowplaying", it) } }

        val folder = prefs.playlistTreeUri?.let { PlaylistFolder(context, it) }?.takeIf { it.usable }
        val written = prefs.written()
        val playlists = JSONArray()
        if (folder != null) {
            for (f in folder.list()) {
                val key = f.name.substringBeforeLast('.')
                if (written[f.name] == f.sha) {
                    // 우리가 써 둔 그대로 → 삼성 뮤직 쪽 내용은 알 수 없음 (PC가 기준점으로 판단)
                    playlists.put(JSONObject().put("key", key).put("name", key).put("file", f.name).put("state", "ours").put("mtime", f.lastModified))
                    continue
                }
                val parsed = PlaylistFormat.parse(f.text, f.name)
                val entries = JSONArray()
                var unresolved = 0
                for (item in parsed.items) {
                    val t = resolve(item.path, folder.absolutePath, byPath, byName)
                    if (t != null) entries.put(t.qh) else unresolved++
                }
                playlists.put(
                    JSONObject()
                        .put("key", key)
                        .put("name", parsed.name.ifBlank { key })
                        .put("file", f.name)
                        .put("state", "samsung")
                        .put("entries", entries)
                        .put("unresolved", unresolved)
                        .put("mtime", f.lastModified),
                )
            }
        }

        val trackArray = JSONArray()
        for (t in tracks) {
            trackArray.put(
                JSONObject()
                    .put("qh", t.qh)
                    .put("size", t.size)
                    .put("path", t.path)
                    .put("title", t.title)
                    .put("artist", t.artist)
                    .put("album", t.album)
                    .put("duration", t.durationMs / 1000.0),
            )
        }
        val manifest = JSONObject()
            .put("deviceId", prefs.deviceId)
            .put("deviceName", prefs.deviceName)
            .put("playlistsEnabled", folder != null)
            .put("tracks", trackArray)
            .put("playlists", playlists)

        onProgress("PC와 목록을 맞춰 보는 중…")
        val plan = client.postJson("/sync/manifest", manifest)
        val errors = mutableListOf<String>()

        // 폰 → PC
        var uploaded = 0
        val up = plan.optJSONArray("upload") ?: JSONArray()
        for (i in 0 until up.length()) {
            if (isStopped()) throw StoppedException()
            val t = byQh[up.getString(i)] ?: continue
            onProgress("PC로 보내는 중 ${i + 1}/${up.length()} · ${t.title}")
            try {
                client.upload(t.qh, t.path, context.contentResolver, t.uri, t.size)
                uploaded++
            } catch (e: Exception) {
                errors += "${t.displayName}: ${e.message}"
            }
        }

        // PC → 폰
        var downloaded = 0
        val received = HashMap<String, Pair<String, JSONObject>>() // 곡 ID → (폰 경로, 곡 정보)
        val down = plan.optJSONArray("download") ?: JSONArray()
        for (i in 0 until down.length()) {
            if (isStopped()) throw StoppedException()
            val d = down.getJSONObject(i)
            onProgress("폰으로 받는 중 ${i + 1}/${down.length()} · ${d.optString("title")}")
            try {
                val saved = MediaSaver.download(context, client, d)
                received[saved.qh] = saved.path to d
                downloaded++
            } catch (e: Exception) {
                errors += "${d.optString("name")}: ${e.message}"
            }
        }

        // 재생목록 쓰기 (삼성 뮤직에서 '플레이리스트 가져오기'로 반영)
        var playlistsWritten = 0
        val writtenOut = JSONArray()
        val pls = plan.optJSONArray("playlists") ?: JSONArray()
        if (folder != null) {
            for (i in 0 until pls.length()) {
                val p = pls.getJSONObject(i)
                val file = p.optString("file").ifBlank { p.getString("key") + ".m3u" }
                if (p.optString("action") == "delete") {
                    // 우리가 쓴 파일이 그대로일 때만 지운다 (삼성 뮤직이 쓴 백업은 건드리지 않음)
                    folder.find(file)?.let { cur -> if (written[file] == cur.sha) folder.delete(file) }
                    written.remove(file)
                    continue
                }
                val ids = p.optJSONArray("entries") ?: JSONArray()
                val items = mutableListOf<PlaylistFormat.Item>()
                val entries = JSONArray()
                for (k in 0 until ids.length()) {
                    val qh = ids.getString(k)
                    val t = byQh[qh]
                    val got = received[qh]
                    val item = when {
                        t != null -> PlaylistFormat.Item(t.path, t.title, t.artist, t.durationMs / 1000.0)
                        got != null -> PlaylistFormat.Item(got.first, got.second.optString("title"), got.second.optString("artist"), got.second.optDouble("duration", 0.0))
                        else -> null // 폰에 없는 곡은 빼고, 실제로 쓴 목록을 PC에 알려 준다
                    } ?: continue
                    items += item
                    entries.put(qh)
                }
                val bytes = PlaylistFormat.writeM3u(items).toByteArray(Charsets.UTF_8)
                if (folder.write(file, bytes)) {
                    written[file] = SyncCrypto.sha256hex(bytes)
                    writtenOut.put(JSONObject().put("key", p.getString("key")).put("file", file).put("entries", entries))
                    playlistsWritten++
                } else {
                    errors += "$file: 재생목록 파일을 쓰지 못했어요"
                }
            }
        }
        prefs.saveWritten(written)

        client.postJson(
            "/sync/commit",
            JSONObject()
                .put("syncId", plan.getString("syncId"))
                .put("uploaded", uploaded)
                .put("downloaded", downloaded)
                .put("written", writtenOut)
                .put("errors", JSONArray(errors)),
        )
        val notices = plan.optJSONArray("notices")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList()
        return Result(uploaded, downloaded, playlistsWritten, notices, errors)
    }

    /** 재생목록의 경로를 폰의 곡으로: 절대/상대 경로 → 옛 SD카드 경로 → 파일 이름 */
    private fun resolve(raw: String, folderPath: String, byPath: Map<String, PhoneTrack>, byName: Map<String, PhoneTrack>): PhoneTrack? {
        if (raw.isBlank()) return null
        val p = raw.replace('\\', '/')
        val abs = if (p.startsWith("/")) p else normalize("$folderPath/$p")
        byPath[abs.lowercase()]?.let { return it }
        byPath[abs.replaceFirst(Regex("^/(mnt/)?sdcard/"), "/storage/emulated/0/").lowercase()]?.let { return it }
        return byName[p.substringAfterLast('/').lowercase()]
    }

    private fun normalize(path: String): String {
        val out = ArrayDeque<String>()
        for (seg in path.split('/')) {
            when (seg) {
                "", "." -> Unit
                ".." -> out.removeLastOrNull()
                else -> out.addLast(seg)
            }
        }
        return "/" + out.joinToString("/")
    }

    companion object {
        fun hasMediaPermission(context: Context): Boolean {
            val perm = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
            return ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED
        }
    }
}
