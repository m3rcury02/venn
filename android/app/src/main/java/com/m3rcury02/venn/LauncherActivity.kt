package com.m3rcury02.venn

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
            promptForSearchTile()
        }
    }

    override fun shouldLaunchImmediately(): Boolean = !requestSearchTile

    private fun shouldRequestSearchTile(savedInstanceState: Bundle?): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            savedInstanceState == null &&
            intent.data == null &&
            !preferences().getBoolean(TILE_PROMPTED_KEY, false)

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun promptForSearchTile() {
        requestSearchTilePlacement(
            onResult = {
                preferences().edit().putBoolean(TILE_PROMPTED_KEY, true).apply()
                launchTwa()
            },
            onFailure = {
                preferences().edit().putBoolean(TILE_PROMPTED_KEY, true).apply()
                launchTwa()
            },
        )
    }

    private fun preferences() =
        getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)

    companion object {
        private const val PREFERENCES_NAME = "venn_native"
        private const val TILE_PROMPTED_KEY = "search_tile_prompted"
    }
}
