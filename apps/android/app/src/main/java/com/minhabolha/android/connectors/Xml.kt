package com.minhabolha.android.connectors

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader

/**
 * Árvore XML mínima para ler feeds RSS/Atom.
 *
 * Usa o parser já incluído no Android, sem dependências externas. Namespaces
 * ficam desligados para preservar prefixos (`media:thumbnail`, `yt:videoId`),
 * como no desktop.
 */
class XmlNode(
    val name: String,
    val attributes: Map<String, String>
) {
    val children = mutableListOf<XmlNode>()
    private val textBuilder = StringBuilder()

    val text: String
        get() = textBuilder.toString()

    fun appendText(value: String) {
        textBuilder.append(value)
    }

    fun child(name: String): XmlNode? = children.firstOrNull { it.name == name }

    fun childrenNamed(name: String): List<XmlNode> = children.filter { it.name == name }

    fun attr(name: String): String? = attributes[name]

    /** Texto do primeiro filho com esse nome, ou o próprio texto. */
    fun textOf(name: String): String = child(name)?.text?.trim().orEmpty()
}

object Xml {

    fun parse(source: String): XmlNode? {
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(StringReader(source))

        val stack = ArrayDeque<XmlNode>()
        var root: XmlNode? = null

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    val attributes = mutableMapOf<String, String>()
                    for (index in 0 until parser.attributeCount) {
                        attributes[parser.getAttributeName(index)] = parser.getAttributeValue(index)
                    }
                    val node = XmlNode(parser.name, attributes)
                    if (stack.isEmpty()) {
                        root = node
                    } else {
                        stack.last().children.add(node)
                    }
                    stack.addLast(node)
                }

                XmlPullParser.TEXT -> {
                    stack.lastOrNull()?.appendText(parser.text.orEmpty())
                }

                XmlPullParser.END_TAG -> {
                    if (stack.isNotEmpty()) stack.removeLast()
                }
            }
            event = parser.next()
        }

        return root
    }
}
