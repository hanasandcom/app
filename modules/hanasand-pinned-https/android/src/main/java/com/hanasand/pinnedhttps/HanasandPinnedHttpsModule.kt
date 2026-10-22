package com.hanasand.pinnedhttps

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URL
import java.security.MessageDigest
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class HanasandPinnedHttpsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HanasandPinnedHttps")

    AsyncFunction("request") { url: String, pin: String, method: String, headers: Map<String, String>, body: String? ->
      val target = URL(url)
      require(target.protocol.equals("https", ignoreCase = true) && target.host.isNotBlank() &&
        target.userInfo == null && target.query == null && target.ref == null) {
        "Pinned desktop requests require an HTTPS URL without credentials, a query, or a fragment."
      }
      require(Regex("^[0-9a-f]{64}$").matches(pin)) { "Certificate pin must be lowercase SHA-256 hex." }
      val connection = (target.openConnection() as? HttpsURLConnection)
        ?: throw IllegalArgumentException("Pinned desktop requests require HTTPS.")
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = false
      connection.requestMethod = method
      connection.useCaches = false
      val trustManager = PinnedTrustManager(pin)
      val context = SSLContext.getInstance("TLS")
      context.init(null, arrayOf<TrustManager>(trustManager), null)
      connection.sslSocketFactory = context.socketFactory
      connection.hostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      if (body != null) {
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      try {
        val status = connection.responseCode
        val input = if (status >= 400) connection.errorStream else connection.inputStream
        val responseBody = input?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        val responseHeaders = connection.headerFields
          .filterKeys { it != null }
          .mapKeys { it.key!! }
          .mapValues { it.value.joinToString(", ") }
        mapOf("status" to status, "headers" to responseHeaders, "body" to responseBody)
      } finally {
        connection.disconnect()
      }
    }
  }
}

private class PinnedTrustManager(private val expectedPin: String) : X509TrustManager {
  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    throw java.security.cert.CertificateException("Client certificates are not supported.")
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw java.security.cert.CertificateException("Server certificate chain is empty.")
    leaf.checkValidity()
    val actualPin = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
      .joinToString("") { "%02x".format(it) }
    if (!MessageDigest.isEqual(actualPin.toByteArray(Charsets.US_ASCII), expectedPin.toByteArray(Charsets.US_ASCII))) {
      throw java.security.cert.CertificateException("Desktop certificate pin mismatch.")
    }
  }
}
