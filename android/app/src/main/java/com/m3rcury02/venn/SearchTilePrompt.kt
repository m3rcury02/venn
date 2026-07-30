package com.m3rcury02.venn

import android.app.Activity
import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal fun Activity.requestSearchTilePlacement(
    onResult: (Int) -> Unit,
    onFailure: () -> Unit,
) {
    try {
        getSystemService(StatusBarManager::class.java).requestAddTileService(
            ComponentName(this, SearchTileService::class.java),
            getString(R.string.search_tile_label),
            Icon.createWithResource(this, R.drawable.ic_search_tile),
            mainExecutor,
            onResult,
        )
    } catch (_: RuntimeException) {
        onFailure()
    }
}
