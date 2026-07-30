package com.m3rcury02.venn

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import androidx.annotation.RequiresApi
import com.google.androidbrowserhelper.trusted.LauncherActivity as TrustedLauncherActivity

class LauncherActivity : TrustedLauncherActivity() {
    private var requestSearchTile = false

    override fun onCreate(savedInstanceState: Bundle?) {
        requestSearchTile = shouldRequestSearchTile(savedInstanceState)
        super.onCreate(savedInstanceState)

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            requestSearchTile &&
            !isFinishing
        ) {
            requestSearchTile()
        }
    }

    override fun shouldLaunchImmediately(): Boolean = !requestSearchTile

    private fun shouldRequestSearchTile(savedInstanceState: Bundle?): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            savedInstanceState == null &&
            intent.data == null &&
            !preferences().getBoolean(TILE_PROMPTED_KEY, false)

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun requestSearchTile() {
        val statusBarManager = getSystemService(StatusBarManager::class.java)

        try {
            statusBarManager.requestAddTileService(
                ComponentName(this, SearchTileService::class.java),
                getString(R.string.search_tile_label),
                Icon.createWithResource(this, R.drawable.ic_search_tile),
                mainExecutor,
            ) {
                preferences().edit().putBoolean(TILE_PROMPTED_KEY, true).apply()
                launchTwa()
            }
        } catch (_: RuntimeException) {
            preferences().edit().putBoolean(TILE_PROMPTED_KEY, true).apply()
            launchTwa()
        }
    }

    private fun preferences() =
        getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)

    companion object {
        private const val PREFERENCES_NAME = "venn_native"
        private const val TILE_PROMPTED_KEY = "search_tile_prompted"
    }
}
