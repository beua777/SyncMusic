package com.syncmusic.companion

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.TimeUnit

/**
 * 같은 Wi-Fi 자동 동기화: Wi-Fi(데이터 요금 없는 네트워크)에 있으면 약 15분마다 + 앱을 열 때 바로.
 * PC를 못 찾으면(집이 아니거나 PC가 꺼짐) 조용히 다음 기회를 기다린다.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = Prefs(applicationContext)
        val manual = inputData.getBoolean(KEY_MANUAL, false)
        if (!prefs.isPaired || (!manual && !prefs.autoSync)) return@withContext Result.success()
        try {
            val r = SyncEngine(
                applicationContext,
                onProgress = { msg -> setProgressAsync(workDataOf(KEY_MSG to msg)) },
                isStopped = { isStopped },
            ).run()
            prefs.lastSyncAt = System.currentTimeMillis()
            prefs.lastSummary = r.summary
            prefs.lastError = null
            if (r.changed || manual) prefs.addLog("${stamp()} ${r.summary}")
            r.notices.forEach { prefs.addLog("${stamp()} 알림: $it") }
            r.errors.take(5).forEach { prefs.addLog("${stamp()} 오류: $it") }
            Notifications.syncDone(applicationContext, r)
            Result.success(workDataOf(KEY_MSG to r.summary))
        } catch (e: IOException) {
            prefs.lastError = e.message
            if (manual) {
                prefs.addLog("${stamp()} ${e.message}")
                Result.failure(workDataOf(KEY_MSG to (e.message ?: "동기화하지 못했어요")))
            } else {
                Result.success()
            }
        } catch (e: Exception) {
            val msg = e.message ?: e.toString()
            prefs.lastError = msg
            prefs.addLog("${stamp()} 오류: $msg")
            Result.failure(workDataOf(KEY_MSG to msg))
        }
    }

    companion object {
        const val KEY_MANUAL = "manual"
        const val KEY_MSG = "msg"
        const val PERIODIC = "syncmusic-periodic"
        const val ONCE = "syncmusic-now"

        private fun stamp(): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())

        fun schedulePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancelPeriodic(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }

        fun runNow(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setInputData(workDataOf(KEY_MANUAL to true))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, req)
        }
    }
}
