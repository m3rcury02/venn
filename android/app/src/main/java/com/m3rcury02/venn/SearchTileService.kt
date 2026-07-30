package com.m3rcury02.venn

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.net.toUri

class SearchTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = Tile.STATE_ACTIVE
            label = getString(R.string.search_tile_label)
            contentDescription = getString(R.string.search_tile_description)
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()

        if (isLocked) {
            unlockAndRun(::openSearch)
        } else {
            openSearch()
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @Suppress("DEPRECATION")
    private fun openSearch() {
        val intent = Intent(this, LauncherActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            data = SEARCH_URL.toUri()
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            startActivityAndCollapse(pendingIntent)
        } else {
            startActivityAndCollapse(intent)
        }
    }

    companion object {
        private const val SEARCH_URL = "https://venn-roan.vercel.app/search"
    }
}
