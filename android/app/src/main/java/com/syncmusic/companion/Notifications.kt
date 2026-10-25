package com.syncmusic.companion

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifications {
    private const val CHANNEL = "sync"

    fun createChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "PC 동기화", NotificationManager.IMPORTANCE_LOW).apply {
                description = "PC와 음악·재생목록을 주고받은 결과"
            },
        )
    }

    /** 바뀐 게 있을 때만 알림. PC에서 재생목록이 바뀌었으면 삼성 뮤직에서 가져오기를 안내한다 */
    @SuppressLint("MissingPermission")
    fun syncDone(context: Context, r: SyncEngine.Result) {
        if (!r.changed) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val needsImport = r.playlistsWritten > 0
        val details = buildString {
            append(r.summary)
            if (needsImport) append("\n삼성 뮤직 → 설정 → 플레이리스트 관리 → 플레이리스트 가져오기를 눌러 주세요")
            r.notices.forEach { append("\n").append(it) }
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (needsImport) "PC에서 재생목록이 바뀌었어요" else "PC와 동기화했어요")
            .setContentText(r.summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(details))
            .setContentIntent(open)
            .setAutoCancel(true)
        if (needsImport) {
            context.packageManager.getLaunchIntentForPackage(NowPlaying.SAMSUNG_MUSIC)?.let { launch ->
                builder.addAction(0, "삼성 뮤직 열기", PendingIntent.getActivity(context, 1, launch, PendingIntent.FLAG_IMMUTABLE))
            }
        }
        runCatching { NotificationManagerCompat.from(context).notify(1, builder.build()) }
    }
}
