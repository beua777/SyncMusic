package com.syncmusic.companion

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannel(this)
        if (Prefs(this).autoSync) SyncWorker.schedulePeriodic(this)
    }
}
