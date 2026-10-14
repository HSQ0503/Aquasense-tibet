#include "network_access.h"
#include "secrets.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <mbedtls/sha256.h>
#include <sys/time.h>
#include <time.h>

#ifndef PORTAL_AUTO_ACCEPT
#define PORTAL_AUTO_ACCEPT false
#define PORTAL_SSID ""
#define PORTAL_HOST ""
#define PORTAL_TERMS_SHA256 ""
#endif
#ifndef BUILD_UNIX_TIME
#define BUILD_UNIX_TIME 0
#endif

namespace {
const char *probe_url = "http://captive.apple.com/hotspot-detect.html";

class LimitedBody : public Stream {
 public:
  String text;
  bool overflow = false;
  size_t write(uint8_t value) override { return write(&value, 1); }
  size_t write(const uint8_t *buffer, size_t size) override {
    if (text.length() + size > 24576) { overflow = true; return 0; }
    return text.concat(reinterpret_cast<const char *>(buffer), size) ? size : 0;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

struct Page {
  int status = -1;
  String body;
  String location;
  String cookie;
};

Page request_page(const String &url, const char *form = nullptr, const String &cookie = "") {
  WiFiClient transport;
  HTTPClient request;
  Page page;
  request.setConnectTimeout(3000);
  request.setTimeout(5000);
  request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  const char *names[] = {"Location", "Set-Cookie"};
  request.collectHeaders(names, 2);
  if (!request.begin(transport, url)) return page;
  if (cookie.length()) request.addHeader("Cookie", cookie);
  if (form) request.addHeader("Content-Type", "application/x-www-form-urlencoded");
  page.status = form ? request.POST(String(form)) : request.GET();
  page.location = request.header("Location");
  page.cookie = request.header("Set-Cookie");
  int separator = page.cookie.indexOf(';');
  if (separator >= 0) page.cookie = page.cookie.substring(0, separator);
  if (page.status > 0) {
    LimitedBody body;
    if (request.writeToStream(&body) >= 0 && !body.overflow) page.body = body.text;
  }
  request.end();
  return page;
}

bool has_internet(const Page &page) {
  return page.status == 200 && page.body.indexOf("<TITLE>Success</TITLE>") >= 0 &&
         page.body.indexOf("<BODY>Success</BODY>") >= 0;
}

bool terms_match(const String &body) {
  int start = body.indexOf("Disclaimer Of");
  int end = body.indexOf("<input type=\"button\"", start);
  if (start < 0 || end <= start) return false;
  String normalized;
  normalized.reserve(end - start);
  for (int i = start; i < end; i++) {
    char c = body[i];
    if (c != ' ' && c != '\r' && c != '\n' && c != '\t' && c != '\f' && c != '\v') normalized += c;
  }
  unsigned char digest[32];
  if (mbedtls_sha256(reinterpret_cast<const unsigned char *>(normalized.c_str()), normalized.length(), digest, 0) != 0) return false;
  char hex[65];
  for (int i = 0; i < 32; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
  return String(hex) == PORTAL_TERMS_SHA256;
}
}

void initialize_network_clock() {
  // A trusted build-time floor permits TLS validation before NTP becomes reachable.
  if (time(nullptr) < BUILD_UNIX_TIME) {
    timeval initial = {BUILD_UNIX_TIME, 0};
    settimeofday(&initial, nullptr);
  }
  configTime(0, 0, "time.google.com", "pool.ntp.org");
}

bool check_internet_access() {
  Page probe = request_page(probe_url);
  if (has_internet(probe)) return true;
  if (!PORTAL_AUTO_ACCEPT || WiFi.SSID() != PORTAL_SSID || !strlen(PORTAL_HOST)) {
    Serial.println("Internet unavailable; portal acceptance is not configured for this network.");
    return false;
  }
  const String origin = String("http://") + PORTAL_HOST;
  const String login = origin + "/login.html";
  if (!probe.location.startsWith(login) && probe.body.indexOf(login) < 0) {
    Serial.println("Unknown portal; automatic acceptance paused.");
    return false;
  }
  Page portal = request_page(login + "?redirect=http://captive.apple.com/hotspot-detect.html");
  if (portal.status != 200 || !terms_match(portal.body)) {
    Serial.println("Portal unavailable or approved terms changed; automatic acceptance paused.");
    return false;
  }
  // The observed portal script sets the action to its absent switch_url value,
  // producing /undefined; this is also the Mac's recorded acceptance endpoint.
  Page accepted = request_page(origin + "/undefined",
    "buttonClicked=4&redirect_url=http%3A%2F%2Fcaptive.apple.com%2Fhotspot-detect.html&err_flag=0", portal.cookie);
  Serial.print("Approved portal form submitted; HTTP ");
  Serial.println(accepted.status);
  bool connected = has_internet(request_page(probe_url));
  Serial.println(connected ? "Internet access verified." : "Portal has not granted internet access; will retry.");
  return connected;
}
