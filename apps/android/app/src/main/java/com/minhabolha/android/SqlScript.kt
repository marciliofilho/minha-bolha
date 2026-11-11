package com.minhabolha.android

/**
 * Utilitários para executar scripts SQL vindos das migrations compartilhadas.
 *
 * As migrations são as mesmas do desktop (`apps/api/src/db/migrations`), então
 * o esquema do Android nasce idêntico ao do SQLite do desktop.
 */
object SqlScript {

    /**
     * Divide um script em comandos individuais.
     *
     * O `SQLiteDatabase.execSQL` do Android executa apenas o primeiro comando de
     * uma string, então é preciso separar respeitando comentários e literais.
     */
    fun split(script: String): List<String> {
        val statements = mutableListOf<String>()
        val current = StringBuilder()
        var index = 0

        while (index < script.length) {
            val char = script[index]
            when {
                char == '-' && index + 1 < script.length && script[index + 1] == '-' -> {
                    // Comentário de linha até o fim da linha.
                    while (index < script.length && script[index] != '\n') index++
                }

                char == '/' && index + 1 < script.length && script[index + 1] == '*' -> {
                    // Comentário de bloco.
                    index += 2
                    while (index + 1 < script.length &&
                        !(script[index] == '*' && script[index + 1] == '/')
                    ) {
                        index++
                    }
                    index += 2
                }

                char == '\'' || char == '"' -> {
                    val quote = char
                    current.append(char)
                    index++
                    while (index < script.length) {
                        val inner = script[index]
                        current.append(inner)
                        if (inner == quote) {
                            // Aspas duplicadas são escape dentro do literal.
                            if (index + 1 < script.length && script[index + 1] == quote) {
                                current.append(quote)
                                index += 2
                                continue
                            }
                            index++
                            break
                        }
                        index++
                    }
                }

                char == ';' -> {
                    val statement = current.toString().trim()
                    if (statement.isNotEmpty()) statements.add(statement)
                    current.setLength(0)
                    index++
                }

                else -> {
                    current.append(char)
                    index++
                }
            }
        }

        val tail = current.toString().trim()
        if (tail.isNotEmpty()) statements.add(tail)
        return statements
    }
}
