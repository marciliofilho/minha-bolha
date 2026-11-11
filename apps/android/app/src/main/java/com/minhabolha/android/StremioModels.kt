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
    val createdAt: String
)
