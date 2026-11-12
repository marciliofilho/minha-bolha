package com.minhabolha.android

import org.json.JSONObject

/**
 * Lê uma string opcional de um JSONObject sem transformar `null` em "null".
 *
 * O `optString` do org.json no Android devolve a string `"null"` quando o campo
 * existe com valor null. Isso já gravou títulos "null" no calendário e URLs de
 * imagem inválidas. Use este helper para campos opcionais vindos de APIs.
 */
fun JSONObject.optText(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().ifEmpty { null }
}
