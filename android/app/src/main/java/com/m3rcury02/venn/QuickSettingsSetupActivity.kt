package com.m3rcury02.venn

import android.app.Activity
import android.app.StatusBarManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.annotation.RequiresApi

class QuickSettingsSetupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestSearchTilePlacement(
                onResult = ::finishWithResult,
                onFailure = { finishWithMessage(R.string.search_tile_manual_instructions) },
            )
        } else {
            finishWithMessage(R.string.search_tile_manual_instructions)
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun finishWithResult(result: Int) {
        val message = when (result) {
            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED ->
                R.string.search_tile_added

            StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED ->
                R.string.search_tile_already_added

            else -> R.string.search_tile_manual_instructions
        }

        finishWithMessage(message)
    }

    private fun finishWithMessage(message: Int) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        finish()
    }
}
