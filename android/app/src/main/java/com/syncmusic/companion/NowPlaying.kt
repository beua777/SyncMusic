package com.syncmusic.companion

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.support.v4.media.session.MediaControllerCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

/** 다른 앱(삼성 뮤직)의 재생 세션을 읽으려면 '알림 접근'이 필요해서 두는 빈 서비스 */
class NowPlayingListener : NotificationListenerService()

/** 이어듣기: 삼성 뮤직에서 듣던 곡·위치·대기열 순서·셔플/반복을 PC로 보낸다 (docs/PLAN.md 5장 S13) */
object NowPlaying {
    const val SAMSUNG_MUSIC = "com.sec.android.app.music"

    fun hasAccess(context: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    fun read(context: Context, tracks: List<PhoneTrack>? = null): JSONObject? {
        if (!hasAccess(context)) return null
        val msm = context.getSystemService(MediaSessionManager::class.java) ?: return null
        val sessions = try {
            msm.getActiveSessions(ComponentName(context, NowPlayingListener::class.java))
        } catch (e: SecurityException) {
            return null
        }
        val c = sessions.firstOrNull { it.packageName == SAMSUNG_MUSIC }
            ?: sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: return null
        val md = c.metadata ?: return null
        val st = c.playbackState
        val playing = st?.state == PlaybackState.STATE_PLAYING
        var position = st?.position ?: 0L
        if (st != null && playing) position += ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong()

        // 대기열 항목의 mediaId가 MediaStore 번호이면 곡 ID(quick hash)까지 붙인다 (아니면 PC가 제목·가수로 찾음)
        val byMediaId = tracks?.associateBy { it.mediaId }.orEmpty()
        fun qhFor(mediaId: String?): Any = mediaId?.substringAfterLast('/')?.toLongOrNull()?.let { byMediaId[it]?.qh } ?: JSONObject.NULL

        val queue = JSONArray()
        var activeIndex = -1
        c.queue?.forEachIndexed { i, item ->
            val d = item.description
            if (st != null && item.queueId == st.activeQueueItemId) activeIndex = i
            queue.put(
                JSONObject()
                    .put("title", d.title?.toString().orEmpty())
                    .put("artist", d.subtitle?.toString().orEmpty())
                    .put("album", d.description?.toString().orEmpty())
                    .put("qh", qhFor(d.mediaId)),
            )
        }

        // 셔플·반복은 호환 컨트롤러로만 읽힌다. 앱이 알려 주지 않으면 기본값
        var shuffle = false
        var repeat = "off"
        runCatching {
            val compat = MediaControllerCompat(context, MediaSessionCompat.Token.fromToken(c.sessionToken))
            val deadline = SystemClock.elapsedRealtime() + 800
            while (!compat.isSessionReady && SystemClock.elapsedRealtime() < deadline) Thread.sleep(40)
            shuffle = compat.shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_ALL || compat.shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_GROUP
            repeat = when (compat.repeatMode) {
                PlaybackStateCompat.REPEAT_MODE_ONE -> "one"
                PlaybackStateCompat.REPEAT_MODE_ALL, PlaybackStateCompat.REPEAT_MODE_GROUP -> "all"
                else -> "off"
            }
        }

        val current = JSONObject()
            .put("title", md.getString(MediaMetadata.METADATA_KEY_TITLE).orEmpty())
            .put("artist", md.getString(MediaMetadata.METADATA_KEY_ARTIST).orEmpty())
            .put("album", md.getString(MediaMetadata.METADATA_KEY_ALBUM).orEmpty())
            .put("durationMs", md.getLong(MediaMetadata.METADATA_KEY_DURATION))
            .put("qh", qhFor(md.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)))
        return JSONObject()
            .put("app", c.packageName)
            .put("current", current)
            .put("positionMs", position)
            .put("playing", playing)
            .put("shuffle", shuffle)
            .put("repeat", repeat)
            .put("queue", queue)
            .put("activeIndex", activeIndex)
    }
}
