package com.minhabolha.android

/** Erro de API com status HTTP e código estável usado pela interface. */
class HubException(
    val status: Int,
    val code: String,
    message: String
) : Exception(message)
