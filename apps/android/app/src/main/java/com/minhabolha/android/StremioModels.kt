package com.minhabolha.android

import org.json.JSONObject

/** Addon do Stremio já normalizado a partir do manifest. */
data class StremioAddonRow(
    val id: String,
    val addonId: String?,
    val name: String,
    val version: String?,
    val description: String?,
    val manifest: JSONObject,
    val transportUrl: String,
    val enabled: Boolean,
    val priority: Int,
    val lastTestAt: String?,
    val lastTestOk: Boolean?,
    val lastTestError: String?,
    val lastTestSummary: JSONObject?,
    val createdAt: String
)
